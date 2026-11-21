import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AUDIT_ITEMS, AUDIT_MARKERS } from '../domain/audit/coverage'
import {
  checkCoverage,
  moduleOf,
  scanRepository,
  summarize,
  totals,
  type CoverageRow,
  type ItemEntry,
  type MarkerEntry,
} from '../domain/audit/markers'

// Resumen de cobertura de AuditLog: marcadores implementados, pendientes y excluidos, más los
// ítems sin marcador (N01…). Solo lectura: no usa Payload ni la base. Sale con código 1 si el
// código y domain/audit/coverage.ts no coinciden (la misma comprobación que coverage.test.ts).
//
//   pnpm audit:coverage                  # por módulo
//   pnpm audit:coverage --by-phase       # por fase (F1…F13)
//   pnpm audit:coverage --markdown       # tabla Markdown para un PR o un informe

const args = new Set(process.argv.slice(2))
const byPhase = args.has('--by-phase')
const markdown = args.has('--markdown')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const PHASE_ORDER = [
  'F1',
  'F3',
  'F4',
  'F5',
  'F11',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F12',
  'F13',
  '—',
]
const groupOf = (entry: MarkerEntry | ItemEntry) =>
  byPhase ? entry.phase : 'file' in entry ? moduleOf(entry.file) : '—'
const sortRows = (rows: CoverageRow[]) =>
  byPhase
    ? rows.sort((a, b) => PHASE_ORDER.indexOf(a.group) - PHASE_ORDER.indexOf(b.group))
    : rows.sort((a, b) => a.group.localeCompare(b.group))

const percent = (row: CoverageRow) =>
  `${((100 * row.implemented) / (row.total || 1)).toLocaleString('es-AR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} %`

function branch(): string {
  try {
    return execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return 'sin git'
  }
}

const markerRows = sortRows(summarize(AUDIT_MARKERS, groupOf))
const markerTotal = totals(markerRows, 'Marcadores')
const itemTotal = totals(
  summarize(AUDIT_ITEMS, () => 'Ítems N'),
  'Ítems N (sin marcador)'
)
const blocked = AUDIT_ITEMS.filter(item => item.blockedBy)
const blockedText = blocked.length
  ? `${blocked.length} bloqueado(s): ${blocked.map(item => `${item.id} · ${item.blockedBy}`).join(', ')}`
  : ''

const header = byPhase ? 'Fase' : 'Módulo'
const date = new Date().toLocaleDateString('es-AR')
const title = `Cobertura de AuditLog — ${date} (rama ${branch()})`

if (markdown) {
  const line = (row: CoverageRow, extra = '') =>
    `| ${row.group} | ${row.total} | ${row.implemented} | ${row.pending} | ${row.excluded} | ${percent(row)}${extra} |`
  console.log(`**${title}**\n`)
  console.log(`| ${header} | Total | Implementados | Pendientes | Excluidos | Avance |`)
  console.log('|---|---:|---:|---:|---:|---:|')
  for (const row of markerRows) console.log(line(row))
  console.log(line({ ...markerTotal, group: `**${markerTotal.group}**` }))
  console.log(line(itemTotal, blockedText ? ` (${blockedText})` : ''))
} else {
  const pad = (row: CoverageRow) =>
    `${row.group.padEnd(38)}${String(row.total).padStart(6)}${String(row.implemented).padStart(9)}${String(row.pending).padStart(7)}${String(row.excluded).padStart(7)}`
  console.log(title)
  console.log(
    `${header.padEnd(38)}${'Total'.padStart(6)}${'Implem.'.padStart(9)}${'Pend.'.padStart(7)}${'Excl.'.padStart(7)}`
  )
  for (const row of markerRows) console.log(pad(row))
  console.log('-'.repeat(67))
  console.log(`${pad(markerTotal)}   (${percent(markerTotal)} implementado)`)
  console.log(`${pad(itemTotal)}   ${blockedText ? `(${blockedText})` : ''}`)
}

const problems = checkCoverage(scanRepository(root), AUDIT_MARKERS, file =>
  existsSync(path.join(root, file))
)
if (problems.length) {
  console.error(
    `\n${problems.length} diferencia(s) entre el código y domain/audit/coverage.ts:\n\n${problems.join('\n\n')}`
  )
  process.exit(1)
}
