import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { AuditActionCode } from './catalog'

// Lectura de los marcadores AUDIT del código y comparación con el registro de cobertura
// (domain/audit/coverage.ts). Funciones puras sobre texto, más un recorrido de archivos: no
// importa Payload ni toca la base. Lo usan coverage.test.ts y scripts/audit-coverage.ts.
// Ojo al editar este archivo: una línea de comentario que empiece con la marca seguida de dos
// puntos se tomaría como un marcador más.

export type CoverageStatus = 'implemented' | 'pending' | 'excluded'

export type AuditPhase =
  'F1' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'F8' | 'F9' | 'F10' | 'F11' | 'F12' | 'F13' | '—'

interface CoverageEntryBase {
  id: string
  status: CoverageStatus
  actions: readonly AuditActionCode[]
  phase: AuditPhase
  /** Obligatorio si status es 'excluded': por qué no produce evento. */
  reason?: string
  /** Obligatorio si status es 'implemented': archivo (relativo al repo) donde quedó la captura. */
  implementedIn?: string
  /** Solo para ítems pendientes que no se pueden implementar todavía. */
  blockedBy?: 'descope'
  note?: string
}

/** Un comentario marcador del código (A001…). Se empareja por archivo + texto exacto. */
export interface MarkerEntry extends CoverageEntryBase {
  file: string
  text: string
}

/** Un flujo a cubrir que no tiene marcador en el código (N01…, documento 07 §3). */
export interface ItemEntry extends CoverageEntryBase {
  title: string
}

export interface FoundMarker {
  file: string
  line: number
  text: string
}

const SKIPPED_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  '.pnpm-store',
  'uploads',
  'coverage',
])
const SOURCE_FILE = /\.tsx?$/
const TEST_FILE = /\.test\.tsx?$/
const MARKER_LINE = /^\s*\/\/ ?AUDIT:\s*(.*)$/
const COMMENT_LINE = /^\s*\/\/ ?(.*)$/

const REGISTRY_FILE = 'domain/audit/coverage.ts'

/** Archivos .ts/.tsx del repo (rutas relativas con `/`), sin dependencias, build ni tests. */
export function listSourceFiles(root: string, dir = ''): string[] {
  const files: string[] = []
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relative = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) files.push(...listSourceFiles(root, relative))
    } else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      files.push(relative)
    }
  }
  return files.sort()
}

const openParentheses = (text: string) =>
  (text.match(/\(/g)?.length ?? 0) - (text.match(/\)/g)?.length ?? 0)

/**
 * Marcadores de un archivo. El texto es lo que sigue a la marca. Si el paréntesis queda abierto
 * (marcador partido en varias líneas), se suman las líneas de comentario siguientes hasta
 * cerrarlo, unidas con un espacio.
 */
export function extractMarkers(file: string, source: string): FoundMarker[] {
  const lines = source.split(/\r?\n/)
  const markers: FoundMarker[] = []
  for (let i = 0; i < lines.length; i++) {
    const match = MARKER_LINE.exec(lines[i])
    if (!match) continue
    let text = match[1].trim()
    let next = i + 1
    while (openParentheses(text) > 0 && next < lines.length) {
      const continuation = COMMENT_LINE.exec(lines[next])
      if (!continuation) break
      text = `${text} ${continuation[1].trim()}`
      next++
    }
    markers.push({ file, line: i + 1, text })
  }
  return markers
}

export function scanRepository(root: string): FoundMarker[] {
  return listSourceFiles(root).flatMap(file =>
    extractMarkers(file, readFileSync(path.join(root, file), 'utf8'))
  )
}

function nextMarkerId(entries: readonly MarkerEntry[]): string {
  const max = Math.max(0, ...entries.map(entry => Number(entry.id.slice(1)) || 0))
  return `A${String(max + 1).padStart(3, '0')}`
}

const quote = (text: string) => `«${text}»`

/**
 * Compara los marcadores encontrados con el registro. Devuelve todos los problemas juntos, cada
 * uno con archivo, texto y qué hacer. Lista vacía = cobertura consistente.
 * - pending: el marcador tiene que estar en el código.
 * - implemented: el marcador ya no tiene que estar, e implementedIn tiene que existir.
 * - excluded: el marcador puede seguir o haberse retirado.
 * Textos repetidos dentro de un archivo se emparejan por orden de aparición.
 */
export function checkCoverage(
  found: readonly FoundMarker[],
  entries: readonly MarkerEntry[],
  fileExists: (file: string) => boolean
): string[] {
  const problems: string[] = []
  const matched = new Set<MarkerEntry>()
  const unregistered: FoundMarker[] = []

  for (const marker of found) {
    const candidate = entries.find(
      entry =>
        !matched.has(entry) &&
        entry.status !== 'implemented' &&
        entry.file === marker.file &&
        entry.text === marker.text
    )
    if (candidate) {
      matched.add(candidate)
      continue
    }
    const implemented = entries.find(
      entry =>
        !matched.has(entry) &&
        entry.status === 'implemented' &&
        entry.file === marker.file &&
        entry.text === marker.text
    )
    if (implemented) {
      matched.add(implemented)
      problems.push(
        [
          `${implemented.id} figura como 'implemented', pero su marcador sigue en el código`,
          `  Archivo: ${marker.file}:${marker.line}`,
          `  Texto:   ${quote(marker.text)}`,
          `  Si ya está implementado, borrá el marcador (y su TODO(audit-feature)) del código.`,
          `  Si todavía no, volvé a status: 'pending' en ${REGISTRY_FILE}.`,
        ].join('\n')
      )
      continue
    }
    unregistered.push(marker)
  }

  const missing = entries.filter(entry => entry.status === 'pending' && !matched.has(entry))
  const suggestedId = nextMarkerId(entries)

  for (const marker of unregistered) {
    const orphans = missing.filter(entry => entry.file === marker.file)
    const lines = [
      'Marcador AUDIT sin registrar',
      `  Archivo: ${marker.file}:${marker.line}`,
      `  Texto:   ${quote(marker.text)}`,
    ]
    for (const orphan of orphans)
      lines.push(
        `  ¿Cambiaste el texto de uno existente? En este archivo, ${orphan.id} espera:`,
        `           ${quote(orphan.text)}`,
        `           → actualizá \`text\` de ${orphan.id} en ${REGISTRY_FILE}.`
      )
    lines.push(
      `  ¿Es un marcador nuevo? Agregá en ${REGISTRY_FILE}:`,
      `    { id: '${suggestedId}', file: '${marker.file}', text: '<texto de arriba>',`,
      `      status: 'pending', actions: ['<acción de domain/audit/catalog.ts>'], phase: '<F1…F13>' }`,
      `  ¿No debe producir evento? Usá status: 'excluded' con reason: '<motivo>'.`
    )
    problems.push(lines.join('\n'))
  }

  for (const entry of missing) {
    if (unregistered.some(marker => marker.file === entry.file)) continue // ya sugerido arriba
    problems.push(
      [
        `${entry.id} figura como 'pending', pero su marcador no está en el código`,
        `  Archivo esperado: ${entry.file}`,
        `  Texto esperado:   ${quote(entry.text)}`,
        `  Si lo implementaste: status: 'implemented' con implementedIn: '<archivo>'.`,
        `  Si cambió el texto o se movió de archivo: actualizá \`text\`/\`file\` de ${entry.id}.`,
        `  Si se decidió no auditarlo: status: 'excluded' con reason: '<motivo>'.`,
      ].join('\n')
    )
  }

  for (const entry of entries) {
    if (entry.status === 'implemented' && entry.implementedIn && !fileExists(entry.implementedIn))
      problems.push(
        `${entry.id}: implementedIn apunta a un archivo que no existe (${entry.implementedIn}).`
      )
  }

  return problems
}

/** Reglas internas del registro: IDs, acciones, motivos y estados coherentes. */
export function validateRegistry(
  markers: readonly MarkerEntry[],
  items: readonly ItemEntry[],
  knownActions: ReadonlySet<string>
): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const entry of [...markers, ...items]) {
    const isMarker = 'file' in entry
    if (!(isMarker ? /^A\d{3}$/ : /^N\d{2}$/).test(entry.id))
      problems.push(`${entry.id}: formato de ID inválido (A001… para marcadores, N01… para ítems).`)
    if (seen.has(entry.id)) problems.push(`${entry.id}: ID repetido.`)
    seen.add(entry.id)
    for (const code of entry.actions)
      if (!knownActions.has(code))
        problems.push(`${entry.id}: la acción '${code}' no existe en domain/audit/catalog.ts.`)
    if (entry.status === 'excluded' && !entry.reason?.trim())
      problems.push(`${entry.id}: un 'excluded' necesita reason con el motivo.`)
    if (entry.status === 'implemented' && !entry.implementedIn)
      problems.push(`${entry.id}: un 'implemented' necesita implementedIn con el archivo.`)
    if (entry.status !== 'excluded' && entry.actions.length === 0 && !entry.note?.trim())
      problems.push(`${entry.id}: sin acciones; agregá al menos una o una note que lo explique.`)
    if (entry.blockedBy && entry.status !== 'pending')
      problems.push(`${entry.id}: blockedBy solo tiene sentido en un 'pending'.`)
  }
  return problems
}

export interface CoverageRow {
  group: string
  total: number
  implemented: number
  pending: number
  excluded: number
}

/** Módulo de un archivo: las dos primeras carpetas (domain/tasks) o la primera (endpoints). */
export function moduleOf(file: string): string {
  const segments = file.split('/')
  return segments.length >= 3 ? `${segments[0]}/${segments[1]}` : segments[0]
}

export function summarize(
  entries: readonly (MarkerEntry | ItemEntry)[],
  groupOf: (entry: MarkerEntry | ItemEntry) => string
): CoverageRow[] {
  const rows = new Map<string, CoverageRow>()
  for (const entry of entries) {
    const group = groupOf(entry)
    const row = rows.get(group) ?? { group, total: 0, implemented: 0, pending: 0, excluded: 0 }
    row.total++
    row[entry.status]++
    rows.set(group, row)
  }
  return [...rows.values()]
}

export function totals(rows: readonly CoverageRow[], group: string): CoverageRow {
  return rows.reduce(
    (sum, row) => ({
      group,
      total: sum.total + row.total,
      implemented: sum.implemented + row.implemented,
      pending: sum.pending + row.pending,
      excluded: sum.excluded + row.excluded,
    }),
    { group, total: 0, implemented: 0, pending: 0, excluded: 0 }
  )
}
