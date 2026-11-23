/**
 * Reporter de node:test que verifica que cada archivo de test llegó completo al proceso padre.
 *
 * Por qué existe (F0.8): con `node --test` cada archivo corre en un proceso hijo que manda sus
 * resultados al padre por un pipe. Si el hijo sale antes de terminar de escribir (lo que pasaba
 * con --test-force-exit), los últimos resultados se pierden y la corrida termina en verde con
 * menos tests. El padre no se entera: el hijo salió con código 0.
 *
 * Cómo lo detecta: cada hijo manda, como último evento, un `test:summary` con su archivo y sus
 * contadores. Si a un archivo le falta ese resumen, o llegaron menos tests de los que el hijo
 * contó, la salida se cortó. No necesita una cifra esperada.
 *
 * Falla por defecto (exit 1): si no llega ningún resumen, si llega un evento que no conoce o
 * con una forma distinta de la esperada. Así, si una versión futura de Node cambia estos
 * eventos, la corrida falla en vez de quedar en verde sin verificar nada.
 *
 * Eventos de Node 22 (lib/internal/test_runner/tests_stream.js). No soporta --watch.
 * Un archivo *.test.ts sin tests también falla: desde el padre no se distingue de uno cortado.
 */
import { resolve } from 'node:path'

const KNOWN_EVENTS = new Set([
  'test:complete',
  'test:coverage',
  'test:dequeue',
  'test:diagnostic',
  'test:enqueue',
  'test:fail',
  'test:pass',
  'test:plan',
  'test:start',
  'test:stderr',
  'test:stdout',
  'test:summary',
])

export type TestEvent = { type: string; data?: unknown }

export type CompletenessReport = {
  ok: boolean
  /** El resumen final de la corrida llegó y dice que todo pasó. */
  runSucceeded: boolean
  files: number
  tests: number
  problems: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export function createCompletenessCheck() {
  const testsByFile = new Map<string, number>()
  const fileLevel = new Set<string>() // archivos que el padre reportó como un solo test (sin hijos)
  const summaries = new Map<string, number>()
  const problems: string[] = []
  const unexpected = new Set<string>()
  let runSummaries = 0
  let runSucceeded = false

  const flag = (key: string, message: string) => {
    if (unexpected.has(key)) return
    unexpected.add(key)
    problems.push(message)
  }

  function add(event: TestEvent) {
    if (!KNOWN_EVENTS.has(event.type)) {
      flag(`type:${event.type}`, `evento inesperado: ${event.type}`)
      return
    }
    const data = event.data
    if (event.type === 'test:pass' || event.type === 'test:fail') {
      if (
        !isRecord(data) ||
        typeof data.file !== 'string' ||
        typeof data.name !== 'string' ||
        typeof data.nesting !== 'number'
      ) {
        flag(`shape:${event.type}`, `${event.type} sin file, name o nesting: Node cambió el formato del evento`)
        return
      }
      const details = isRecord(data.details) ? data.details : {}
      if (details.type === 'suite') return
      // Un archivo cuyo hijo no mandó ningún test aparece como un test de nivel 0 con el nombre
      // del archivo. No es un test. Puede ser un archivo sin tests (su hijo no arranca el runner y
      // no manda resumen) o una salida cortada antes del primer resultado: no se distinguen.
      if (data.nesting === 0 && resolve(data.name) === data.file) {
        fileLevel.add(data.file)
        return
      }
      testsByFile.set(data.file, (testsByFile.get(data.file) ?? 0) + 1)
      return
    }
    if (event.type === 'test:summary') {
      if (
        !isRecord(data) ||
        !isRecord(data.counts) ||
        typeof data.counts.tests !== 'number' ||
        typeof data.success !== 'boolean'
      ) {
        flag('shape:test:summary', 'test:summary sin counts.tests o success: Node cambió el formato del evento')
        return
      }
      if (data.file === undefined) {
        runSummaries++
        runSucceeded = data.success
        return
      }
      if (typeof data.file !== 'string') {
        flag('shape:test:summary:file', 'test:summary con un file que no es texto: Node cambió el formato del evento')
        return
      }
      if (summaries.has(data.file)) problems.push(`${data.file}: llegaron dos resúmenes del mismo archivo`)
      summaries.set(data.file, data.counts.tests)
    }
  }

  function finish(): CompletenessReport {
    const result = [...problems]
    if (summaries.size === 0) result.push('no llegó ningún test:summary de los archivos: no se pudo verificar nada')
    if (runSummaries !== 1) result.push(`se esperaba 1 resumen final de la corrida y llegaron ${runSummaries}`)
    const files = new Set([...testsByFile.keys(), ...fileLevel])
    for (const file of files) {
      const received = testsByFile.get(file) ?? 0
      const expected = summaries.get(file)
      if (expected === undefined && received === 0)
        result.push(`${file}: no llegó ningún test ni el resumen del hijo (archivo sin tests o salida cortada)`)
      else if (expected === undefined)
        result.push(`${file}: llegaron ${received} tests y falta el resumen del hijo (salida cortada)`)
      else if (expected !== received) result.push(`${file}: el hijo contó ${expected} tests y llegaron ${received}`)
    }
    for (const [file, expected] of summaries) {
      if (!files.has(file) && expected > 0) result.push(`${file}: el hijo contó ${expected} tests y no llegó ninguno`)
    }
    let tests = 0
    for (const n of testsByFile.values()) tests += n
    return {
      ok: result.length === 0,
      runSucceeded: runSummaries === 1 && runSucceeded,
      files: new Set([...files, ...summaries.keys()]).size,
      tests,
      problems: result,
    }
  }

  return { add, finish }
}

export function formatReport(report: CompletenessReport): string {
  if (report.ok) return `completitud: OK, ${report.files} archivos, ${report.tests} tests\n`
  return `completitud: FALLA (la corrida no se puede dar por buena)\n${report.problems.map((p) => `  - ${p}\n`).join('')}`
}

/**
 * Falla cerrada: el exit code queda en 1 desde que arranca y solo vuelve al valor anterior si la
 * verificación terminó bien y la corrida no falló. Si el proceso sale antes de que el reporter
 * llegue al final, la corrida sale con 1.
 *
 * Su destino tiene que ser un stream propio (`--test-reporter-destination=stderr`), no el mismo
 * stdout que el reporter principal. Con --test-force-exit, el padre espera un `unpipe` por
 * destino; con un destino compartido, el primero que termina libera a los dos y el proceso sale
 * antes de que este reporter imprima nada.
 */
export default async function* completenessReporter(source: AsyncIterable<TestEvent>) {
  const previousExitCode = process.exitCode
  process.exitCode = 1
  const check = createCompletenessCheck()
  for await (const event of source) check.add(event)
  const report = check.finish()
  if (report.ok && report.runSucceeded) process.exitCode = previousExitCode
  yield formatReport(report)
}
