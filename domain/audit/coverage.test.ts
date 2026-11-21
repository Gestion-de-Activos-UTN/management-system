import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AUDIT_ACTIONS } from './catalog'
import { AUDIT_ITEMS, AUDIT_MARKERS } from './coverage'
import {
  checkCoverage,
  extractMarkers,
  moduleOf,
  scanRepository,
  summarize,
  totals,
  validateRegistry,
  type MarkerEntry,
} from './markers'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const knownActions = new Set<string>(AUDIT_ACTIONS.map(action => action.code))
const MARK = '// AUDIT:'

// --- Registro real ---------------------------------------------------------------------------

test('el registro es coherente: IDs, acciones, motivos y estados', () => {
  const problems = validateRegistry(AUDIT_MARKERS, AUDIT_ITEMS, knownActions)
  if (problems.length) assert.fail(problems.join('\n'))
})

test('el registro incluye A001–A107 y N01–N16', () => {
  const ids = new Set([...AUDIT_MARKERS, ...AUDIT_ITEMS].map(entry => entry.id))
  const expected = [
    ...Array.from({ length: 107 }, (_, i) => `A${String(i + 1).padStart(3, '0')}`),
    ...Array.from({ length: 16 }, (_, i) => `N${String(i + 1).padStart(2, '0')}`),
  ]
  assert.deepEqual(
    expected.filter(id => !ids.has(id)),
    []
  )
})

test('N09 (accesos a cuentas) queda bloqueado por Descope', () => {
  const n09 = AUDIT_ITEMS.find(item => item.id === 'N09')
  assert.equal(n09?.status, 'pending')
  assert.equal(n09?.blockedBy, 'descope')
})

test('los marcadores del código coinciden con el registro de cobertura', () => {
  const problems = checkCoverage(scanRepository(ROOT), AUDIT_MARKERS, file =>
    existsSync(path.join(ROOT, file))
  )
  if (problems.length)
    assert.fail(
      `${problems.length} diferencia(s) entre el código y domain/audit/coverage.ts:\n\n${problems.join('\n\n')}`
    )
})

// --- Extracción de marcadores ----------------------------------------------------------------

test('extrae el texto que sigue a la marca y su número de línea', () => {
  const source = ['const a = 1', `  ${MARK} hace algo (chain_hash over {a})`, '  save()'].join('\n')
  assert.deepEqual(extractMarkers('x.ts', source), [
    { file: 'x.ts', line: 2, text: 'hace algo (chain_hash over {a})' },
  ])
})

test('un marcador partido en varias líneas se une hasta cerrar el paréntesis', () => {
  const source = [
    `  ${MARK} emite (chain_hash over {a,`,
    '  // b, c}, previous hash)',
    '  // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent',
  ].join('\n')
  assert.equal(
    extractMarkers('x.ts', source)[0].text,
    'emite (chain_hash over {a, b, c}, previous hash)'
  )
})

test('un comentario debajo de un marcador completo no se suma al texto', () => {
  const source = [`${MARK} completo (x)`, '// comentario explicativo'].join('\n')
  assert.equal(extractMarkers('x.ts', source)[0].text, 'completo (x)')
})

test('la marca dentro de una línea de código no cuenta como marcador', () => {
  assert.deepEqual(extractMarkers('x.ts', `const s = '${MARK} no es un marcador'`), [])
})

// --- Comparación con el registro (casos sintéticos) ------------------------------------------

const entry = (overrides: Partial<MarkerEntry>): MarkerEntry => ({
  id: 'A001',
  file: 'a.ts',
  text: 'texto (x)',
  status: 'pending',
  actions: ['task.claim'],
  phase: 'F4',
  ...overrides,
})
const exists = () => true

test('un marcador nuevo sin registrar informa archivo, texto y cómo registrarlo o excluirlo', () => {
  const [problem] = checkCoverage(
    [{ file: 'b.ts', line: 7, text: 'nuevo (y)' }],
    [entry({ status: 'excluded', reason: 'motivo' })],
    exists
  )
  assert.match(problem, /sin registrar/)
  assert.match(problem, /Archivo: b\.ts:7/)
  assert.match(problem, /Texto: {3}«nuevo \(y\)»/)
  assert.match(problem, /id: 'A002', file: 'b\.ts'/)
  assert.match(problem, /status: 'excluded' con reason/)
})

test('un texto cambiado sugiere actualizar la entrada existente del mismo archivo', () => {
  const problems = checkCoverage(
    [{ file: 'a.ts', line: 3, text: 'texto cambiado (x)' }],
    [entry({})],
    exists
  )
  assert.equal(problems.length, 1)
  assert.match(problems[0], /¿Cambiaste el texto de uno existente\? En este archivo, A001 espera:/)
  assert.match(problems[0], /«texto \(x\)»/)
  assert.match(problems[0], /actualizá `text` de A001/)
})

test('un pending cuyo marcador desapareció explica las tres salidas', () => {
  const [problem] = checkCoverage([], [entry({})], exists)
  assert.match(problem, /A001 figura como 'pending', pero su marcador no está/)
  assert.match(problem, /status: 'implemented'/)
  assert.match(problem, /status: 'excluded'/)
})

test('textos repetidos en un archivo se emparejan por orden de aparición', () => {
  const found = [
    { file: 'a.ts', line: 1, text: 'igual (x)' },
    { file: 'a.ts', line: 9, text: 'igual (x)' },
  ]
  const entries = [
    entry({ id: 'A001', text: 'igual (x)' }),
    entry({ id: 'A002', text: 'igual (x)' }),
  ]
  assert.deepEqual(checkCoverage(found, entries, exists), [])
  const [problem] = checkCoverage(found, entries.slice(0, 1), exists)
  assert.match(problem, /Archivo: a\.ts:9/)
})

test('un implemented cuyo marcador sigue en el código es un error', () => {
  const [problem] = checkCoverage(
    [{ file: 'a.ts', line: 4, text: 'texto (x)' }],
    [entry({ status: 'implemented', implementedIn: 'a.ts' })],
    exists
  )
  assert.match(problem, /A001 figura como 'implemented', pero su marcador sigue/)
})

test('un implemented necesita que implementedIn exista', () => {
  const [problem] = checkCoverage(
    [],
    [entry({ status: 'implemented', implementedIn: 'no-existe.ts' })],
    () => false
  )
  assert.match(problem, /implementedIn apunta a un archivo que no existe/)
})

test('un excluded puede conservar o haber retirado su marcador', () => {
  const excluded = entry({ status: 'excluded', reason: 'motivo', actions: [] })
  assert.deepEqual(checkCoverage([], [excluded], exists), [])
  assert.deepEqual(
    checkCoverage([{ file: 'a.ts', line: 1, text: 'texto (x)' }], [excluded], exists),
    []
  )
})

test('validateRegistry exige motivo en exclusiones y acciones conocidas', () => {
  const problems = validateRegistry(
    [
      entry({ status: 'excluded', actions: [] }),
      entry({ id: 'A002', actions: ['no.existe' as never] }),
      entry({ id: 'A002' }),
    ],
    [],
    knownActions
  )
  assert.ok(problems.some(p => p.startsWith("A001: un 'excluded' necesita reason")))
  assert.ok(problems.some(p => p.includes("la acción 'no.existe' no existe")))
  assert.ok(problems.some(p => p === 'A002: ID repetido.'))
})

// --- Resumen ---------------------------------------------------------------------------------

test('el resumen agrupa por módulo y suma por estado', () => {
  const rows = summarize(
    [
      entry({ file: 'domain/tasks/x.ts' }),
      entry({ id: 'A002', file: 'domain/tasks/y.ts', status: 'implemented' }),
      entry({ id: 'A003', file: 'endpoints/z.ts', status: 'excluded' }),
    ],
    e => ('file' in e ? moduleOf(e.file) : '—')
  )
  assert.deepEqual(rows, [
    { group: 'domain/tasks', total: 2, implemented: 1, pending: 1, excluded: 0 },
    { group: 'endpoints', total: 1, implemented: 0, pending: 0, excluded: 1 },
  ])
  assert.deepEqual(totals(rows, 'Total'), {
    group: 'Total',
    total: 3,
    implemented: 1,
    pending: 1,
    excluded: 1,
  })
})
