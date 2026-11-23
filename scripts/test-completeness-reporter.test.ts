import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import completenessReporter, { createCompletenessCheck, type TestEvent } from './test-completeness-reporter'

const A = resolve('domain/a.test.ts')
const B = resolve('domain/b.test.ts')

const pass = (file: string, name: string, nesting = 0, type = 'test'): TestEvent => ({
  type: 'test:pass',
  data: { file, name, nesting, details: { type, duration_ms: 1 } },
})
const summary = (file: string | undefined, tests: number): TestEvent => ({
  type: 'test:summary',
  data: { file, success: true, counts: { tests, suites: 0, passed: tests, failed: 0 }, duration_ms: 1 },
})
const runSummary = (tests: number) => summary(undefined, tests)

const check = (events: TestEvent[]) => {
  const c = createCompletenessCheck()
  for (const e of events) c.add(e)
  return c.finish()
}

describe('test-completeness-reporter', () => {
  it('da OK cuando cada archivo llegó completo, sin contar suites', () => {
    const report = check([
      { type: 'test:start', data: { file: A, name: 'x', nesting: 0 } },
      pass(A, 'uno', 1),
      pass(A, 'dos', 1),
      pass(A, 'grupo', 0, 'suite'),
      summary(A, 2),
      pass(B, 'tres'),
      summary(B, 1),
      runSummary(3),
    ])
    assert.deepEqual(report, { ok: true, runSucceeded: true, files: 2, tests: 3, problems: [] })
  })

  it('falla si a un archivo le falta el resumen del hijo (salida cortada al final)', () => {
    const report = check([pass(A, 'uno'), pass(A, 'dos'), pass(B, 'tres'), summary(B, 1), runSummary(3)])
    assert.equal(report.ok, false)
    assert.match(report.problems.join('\n'), /a\.test\.ts: llegaron 2 tests y falta el resumen del hijo/)
  })

  it('falla si llegaron menos tests de los que contó el hijo', () => {
    const report = check([pass(A, 'uno'), summary(A, 3), runSummary(1)])
    assert.equal(report.ok, false)
    assert.match(report.problems.join('\n'), /el hijo contó 3 tests y llegaron 1/)
  })

  it('falla si el hijo contó tests y no llegó ninguno', () => {
    const report = check([pass(A, 'uno'), summary(A, 1), summary(B, 2), runSummary(1)])
    assert.equal(report.ok, false)
    assert.match(report.problems.join('\n'), /b\.test\.ts: el hijo contó 2 tests y no llegó ninguno/)
  })

  it('falla por defecto si no llega ningún test:summary', () => {
    const report = check([pass(A, 'uno')])
    assert.equal(report.ok, false)
    assert.match(report.problems.join('\n'), /no llegó ningún test:summary/)
    assert.match(report.problems.join('\n'), /se esperaba 1 resumen final de la corrida y llegaron 0/)
  })

  it('falla por defecto si una corrida vacía no manda nada', () => {
    assert.equal(check([]).ok, false)
  })

  it('falla con un tipo de evento que no conoce', () => {
    const report = check([pass(A, 'uno'), summary(A, 1), runSummary(1), { type: 'test:algo-nuevo', data: {} }])
    assert.equal(report.ok, false)
    assert.deepEqual(report.problems, ['evento inesperado: test:algo-nuevo'])
  })

  it('falla si un evento conocido cambia de forma', () => {
    const sinFile = check([{ type: 'test:pass', data: { name: 'uno', nesting: 0 } }, summary(A, 0), runSummary(0)])
    assert.equal(sinFile.ok, false)
    assert.match(sinFile.problems.join('\n'), /test:pass sin file, name o nesting/)

    const sinCounts = check([pass(A, 'uno'), { type: 'test:summary', data: { file: A } }, runSummary(1)])
    assert.equal(sinCounts.ok, false)
    assert.match(sinCounts.problems.join('\n'), /test:summary sin counts\.tests o success/)
  })

  it('falla si de un archivo solo llega el reporte del padre con su nombre (sin tests o cortado antes)', () => {
    const report = check([pass(A, './domain/a.test.ts'), pass(B, 'tres'), summary(B, 1), runSummary(1)])
    assert.equal(report.ok, false)
    assert.deepEqual(report.problems, [`${A}: no llegó ningún test ni el resumen del hijo (archivo sin tests o salida cortada)`])
  })

  it('no cuenta como test el reporte del padre con el nombre del archivo', () => {
    const report = check([pass(A, 'domain/a.test.ts'), summary(A, 0), runSummary(0)])
    assert.equal(report.ok, true)
    assert.equal(report.tests, 0)
  })

  describe('exit code (falla cerrada)', () => {
    async function* events(list: TestEvent[]) {
      yield* list
    }
    const collect = async (list: TestEvent[]) => {
      const out: string[] = []
      for await (const line of completenessReporter(events(list))) out.push(line)
      return out.join('')
    }
    const withExitCode = async (fn: () => Promise<void>) => {
      const previous = process.exitCode
      try {
        process.exitCode = undefined
        await fn()
      } finally {
        process.exitCode = previous
      }
    }

    it('queda en 1 mientras el reporter no terminó', () =>
      withExitCode(async () => {
        let release: () => void = () => {}
        const gate = new Promise<void>((r) => (release = r))
        async function* slow() {
          yield pass(A, 'uno')
          await gate
        }
        const pending = completenessReporter(slow()).next()
        await new Promise((r) => setImmediate(r))
        assert.equal(process.exitCode, 1)
        release()
        await pending
      }))

    it('vuelve al valor anterior si todo llegó y la corrida pasó', () =>
      withExitCode(async () => {
        const out = await collect([pass(A, 'uno'), summary(A, 1), runSummary(1)])
        assert.equal(out, 'completitud: OK, 1 archivos, 1 tests\n')
        assert.equal(process.exitCode, undefined)
      }))

    it('queda en 1 si la salida está incompleta', () =>
      withExitCode(async () => {
        assert.match(await collect([pass(A, 'uno')]), /^completitud: FALLA/)
        assert.equal(process.exitCode, 1)
      }))

    it('queda en 1 si la salida está completa pero la corrida falló', () =>
      withExitCode(async () => {
        const failedRun: TestEvent = { type: 'test:summary', data: { success: false, counts: { tests: 1 } } }
        assert.match(await collect([pass(A, 'uno'), summary(A, 1), failedRun]), /^completitud: OK/)
        assert.equal(process.exitCode, 1)
      }))
  })

  describe('con el node:test instalado (node --test de punta a punta)', () => {
    // Si una versión de Node cambia los eventos, estos tests fallan aunque la corrida no se corte.
    const runNodeTest = (files: Record<string, string>, extraArgs: string[] = []) => {
      const dir = mkdtempSync(join(tmpdir(), 'siam-completeness-'))
      try {
        for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
        // Sin NODE_TEST_CONTEXT: si no, el node --test anidado se saltea los archivos.
        const env = { ...process.env }
        delete env.NODE_TEST_CONTEXT
        const result = spawnSync(
          process.execPath,
          [
            '--import',
            'tsx',
            '--test',
            ...extraArgs,
            // Igual que en package.json: spec a stdout y este reporter a un stream propio.
            '--test-reporter=spec',
            '--test-reporter-destination=stdout',
            `--test-reporter=${resolve('scripts/test-completeness-reporter.ts')}`,
            '--test-reporter-destination=stderr',
            ...Object.keys(files).map((name) => join(dir, name)),
          ],
          { cwd: process.cwd(), env, encoding: 'utf8', timeout: 60_000 },
        )
        return { status: result.status, stderr: result.stderr.replaceAll(dir, '<dir>') }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
    const withTests =
      "import { test, describe } from 'node:test'\n" +
      "test('a', () => {})\n" +
      "describe('grupo', () => { test('b', () => {}); test('c', () => {}) })\n"

    const twoFiles = { 'uno.test.mjs': withTests, 'dos.test.mjs': "import { test } from 'node:test'\ntest('d', () => {})\n" }

    it('reconoce todos los eventos reales y da OK', () => {
      const result = runNodeTest(twoFiles)
      assert.equal(result.stderr, 'completitud: OK, 2 archivos, 4 tests\n')
      assert.equal(result.status, 0)
    })

    it('con --test-force-exit en el padre igual llega a imprimir y dar OK', () => {
      const result = runNodeTest(twoFiles, ['--test-force-exit'])
      assert.equal(result.stderr, 'completitud: OK, 2 archivos, 4 tests\n')
      assert.equal(result.status, 0)
    })

    it('falla con exit 1 si un archivo no tiene tests (no manda resumen)', () => {
      const result = runNodeTest({ 'uno.test.mjs': withTests, 'vacio.test.mjs': '// sin tests\n' })
      assert.equal(
        result.stderr,
        'completitud: FALLA (la corrida no se puede dar por buena)\n' +
          '  - <dir>/vacio.test.mjs: no llegó ningún test ni el resumen del hijo (archivo sin tests o salida cortada)\n',
      )
      assert.equal(result.status, 1)
    })
  })
})
