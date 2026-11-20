// Plan índice-deficiencias §10.1: read-only simulation of B pura over the current evidence, built
// with the new pair builder (N/A out of the denominator, exclusions applied). Writes nothing.
import config from '../payload.config'
import { BAND_THRESHOLDS, type Criticality } from '../domain/risk/constants'
import {
  CONTROL_IMPORTANCE,
  VISIBILITY_THRESHOLDS,
  calculateDeficiencyIndex,
  type IndexPair,
} from '../domain/risk/deficiency-index'
import { buildDeficiencyPairs, type DeficiencyPair } from '../domain/risk/deficiency-pairs'
import { countDeficiencies, countPendingServices } from '../domain/risk/priority'
import { contributionFromPair } from '../domain/risk/persistRiskEvaluation'
import { buildRiskLists, type SubjectRef } from '../domain/risk/risk-lists'
import { loadRiskInputs } from '../domain/risk/recalculateRisk'
import { initializeSeedPayload } from './seed-payload'

const VARIANTS: Record<string, Readonly<Record<string, number>>> = {
  'vigente 1/2/4/8': CONTROL_IMPORTANCE,
  'lineal 1/2/3/4': Object.fromEntries(
    Object.entries(CONTROL_IMPORTANCE).map(([key, value]) => [
      key,
      ({ 1: 1, 2: 2, 4: 3, 8: 4 } as Record<number, number>)[value],
    ])
  ),
  'A.7.9=4, A.8.22=2': { ...CONTROL_IMPORTANCE, 'A.7.9': 4, 'A.8.22': 2 },
}

const fmt = (value: number | null) => (value === null ? '—' : value.toFixed(1))

function report(label: string, pairs: IndexPair[], detail: boolean) {
  const rows = Object.entries(VARIANTS).map(([variant, importance]) => {
    const result = calculateDeficiencyIndex(pairs, importance)
    return `${variant}: índice ${fmt(result.index)} · cobertura ${fmt(result.coverage)} · ${result.visibility}${result.band ? ` (${result.band})` : ''}`
  })
  console.log(`\n## ${label} — ${pairs.length} pares\n  ${rows.join('\n  ')}`)
  if (!detail) return
  for (const control of calculateDeficiencyIndex(pairs).controls)
    console.log(
      `    ${control.control_key.padEnd(13)} imp ${control.importance} · D ${fmt(control.deficiency === null ? null : control.deficiency * 100)} · cob ${fmt(control.coverage * 100)} · eval ${control.evaluated_pairs}/${control.evaluated_pairs + control.pending_pairs}${control.warning ? ' · ADVERTENCIA' : ''}`
    )
}

function printPriorities(pairs: DeficiencyPair[]) {
  console.log(`  deficiencias únicas por prioridad: ${JSON.stringify(countDeficiencies(pairs))}`)
  console.log(`  servicios pendientes: ${JSON.stringify(countPendingServices(pairs))}`)
  for (const pair of pairs)
    if (pair.evidence.kind === 'network' && pair.evidence.findings.length)
      for (const finding of pair.evidence.findings)
        console.log(
          `    A.8.21   ${pair.asset_key.padEnd(44)} ${finding.service_key} ${finding.baseline} (${finding.state})${finding.previous ? ` · antes prohibido el ${finding.previous.date} [${finding.previous.date_kind}]` : ''} → compliance ${pair.compliance}`
        )
  const seen = new Set<string>()
  for (const pair of pairs)
    for (const reason of pair.reasons)
      if (
        reason.list === 'deficiency' &&
        !reason.subordinate_to &&
        (reason.priority === 'critical' || reason.priority === 'high') &&
        !seen.has(reason.key)
      ) {
        seen.add(reason.key)
        const source =
          reason.source.kind === 'answer'
            ? `${reason.source.question_key}=${reason.source.option_key}`
            : reason.source.check_key
        console.log(`    ${reason.priority.padEnd(8)} ${reason.key.split('|')[0].padEnd(44)} ${source}${reason.adjustments.length ? ` [${reason.adjustments.join(', ')}]` : ''}`)
      }
}


// ---- Fase 8: coherence check of the 40/80 and 25/50/75 cuts (not a validation: demo data is
// designed, not a sample). Seed distribution, results near a cut and a synthetic sweep.

type Result = { label: string; pairs: IndexPair[]; critical: boolean }

const COVERAGE_CUTS = [VISIBILITY_THRESHOLDS.preliminary, VISIBILITY_THRESHOLDS.banded]
const INDEX_CUTS = [BAND_THRESHOLDS.moderate, BAND_THRESHOLDS.high, BAND_THRESHOLDS.veryHigh]
const near = (value: number | null, cuts: readonly number[]) =>
  value !== null && cuts.some(cut => Math.abs(value - cut) <= 5)

function thresholds(results: Result[]) {
  const distribution: Record<string, number> = {}
  const close: string[] = []
  for (const { label, pairs, critical } of results) {
    const result = calculateDeficiencyIndex(pairs)
    const key = result.band ? `${result.visibility}:${result.band}` : result.visibility
    distribution[key] = (distribution[key] ?? 0) + 1
    if (near(result.coverage, COVERAGE_CUTS) || near(result.index, INDEX_CUTS))
      close.push(`    ${label.padEnd(52)} índice ${fmt(result.index)} · cobertura ${fmt(result.coverage)} · ${key}`)
    if (critical)
      console.log(`    motivo crítico: ${label} → índice ${fmt(result.index)} · ${key}`)
  }
  console.log(`  distribución: ${JSON.stringify(distribution)}`)
  console.log(`  a ±5 de un corte (cobertura ${COVERAGE_CUTS.join('/')}, índice ${INDEX_CUTS.join('/')}):`)
  console.log(close.length ? close.join('\n') : '    ninguno')
}

/**
 * Synthetic office independent of the seed: 10 assets × every index control. Rows = answered
 * share (coverage), columns = failing share of the answered pairs, failing first on the most
 * (or least) important controls. Cell: visibility (· hidden, P preliminary) or band initial.
 */
function sweep(order: 'important_first' | 'least_important_first') {
  const criticalities: Criticality[] = ['low', 'low', 'low', 'medium', 'medium', 'medium', 'high', 'high', 'critical', 'critical']
  const controls = Object.keys(CONTROL_IMPORTANCE)
  const BAND_LETTER = { low: 'B', moderate: 'M', high: 'A', very_high: 'X' } as const
  console.log(`\n  barrido sintético (fallas en controles ${order === 'important_first' ? 'más' : 'menos'} importantes primero)`)
  console.log(`  cobertura\\falla ${Array.from({ length: 11 }, (_, f) => `${f * 10}`.padStart(4)).join('')}`)
  for (let a = 0; a <= 10; a += 1) {
    const cells: string[] = []
    let coverage: number | null = null
    for (let f = 0; f <= 10; f += 1) {
      const base = controls.flatMap((control_key, c) =>
        criticalities.map((criticality, i) => ({
          control_key,
          criticality,
          // Rotates by control: every control has a/10 of its assets answered and every asset is
          // answered in a/10 of the controls, so the weighted coverage tracks a.
          answered: (c + i * 3) % 10 < a,
        }))
      )
      const answered = base
        .filter(pair => pair.answered)
        .sort((x, y) =>
          order === 'important_first'
            ? CONTROL_IMPORTANCE[y.control_key] - CONTROL_IMPORTANCE[x.control_key]
            : CONTROL_IMPORTANCE[x.control_key] - CONTROL_IMPORTANCE[y.control_key]
        )
      const failing = new Set(answered.slice(0, Math.round((answered.length * f) / 10)))
      const result = calculateDeficiencyIndex(
        base.map(pair => ({
          control_key: pair.control_key,
          criticality: pair.criticality,
          compliance: pair.answered ? (failing.has(pair) ? 0 : 1) : null,
        }))
      )
      coverage = result.coverage
      cells.push(
        (result.visibility === 'banded'
          ? `${BAND_LETTER[result.band!]}${Math.round(result.index!)}`
          : result.visibility === 'preliminary'
            ? `P${Math.round(result.index!)}`
            : '·'
        ).padStart(4)
      )
    }
    // Row label: the real coverage (weighted by criticality), not the answered share.
    console.log(`  ${`${fmt(coverage)} %`.padStart(14)} ${cells.join('')}`)
  }
}

async function main() {
  const payload = await initializeSeedPayload(config)
  try {
    const { docs: organizations } = await payload.find({
      collection: 'organizations',
      overrideAccess: true,
      depth: 0,
      pagination: false,
    })
    for (const organization of organizations) {
      const organizationId = String(organization.id)
      const inputs = await loadRiskInputs(payload, { organizationId })
      const { pairs, assetCounts, context } = buildDeficiencyPairs({ organizationId, ...inputs })
      // Office and asset results come from the union of their pairs, never from averaging (Plan §3).
      report('Organización (consolidado)', pairs, true)
      console.log(`  activos: ${JSON.stringify(assetCounts)}`)
      console.log(`  contexto: ${JSON.stringify(context)}`)
      printPriorities(pairs)
      // The two lists of the API (contracts §7), same function as the endpoint.
      const lists = buildRiskLists(pairs.map(contributionFromPair), context)
      const subject = (item: { subject: SubjectRef }) =>
        item.subject.kind === 'asset' ? item.subject.asset_key : `${item.subject.kind}${'id' in item.subject ? `:${item.subject.id}` : ''} (${item.subject.affected_assets} activos)`
      console.log(`  listas: ${lists.deficiencies.length} deficiencias · ${lists.pending.length} pendientes`)
      for (const item of lists.deficiencies.slice(0, 5))
        console.log(`    D ${item.priority.padEnd(8)} ${item.control_key.padEnd(13)} ${subject(item)}`)
      for (const item of lists.pending.slice(0, 5))
        console.log(`    P ${item.group.padEnd(8)} ${item.control_key.padEnd(13)} ${subject(item)} · ${item.reasons.map(r => r.service_key ?? r.reason_code).join(', ')}`)
      const results: Result[] = []
      const hasCritical = (rows: DeficiencyPair[]) =>
        rows.some(pair => pair.reasons.some(reason => reason.priority === 'critical' && !reason.subordinate_to))
      // The D26 device: an A.8.21 pending with a dated antecedent.
      const d26 = new Set(
        pairs
          .filter(pair => pair.evidence.kind === 'network' && pair.evidence.findings.some(f => f.previous))
          .map(pair => pair.asset_key)
      )
      for (const office of [...new Set(pairs.map(pair => pair.asset_office_id))].sort()) {
        const officePairs = pairs.filter(pair => pair.asset_office_id === office)
        report(`Oficina ${office}`, officePairs, true)
        // Fase 8: effect of the new D26 device on its office, against the previous seed.
        const withoutD26 = officePairs.filter(pair => !d26.has(pair.asset_key))
        if (withoutD26.length < officePairs.length) report(`Oficina ${office} sin el equipo D26`, withoutD26, false)
        printPriorities(officePairs)
        results.push({ label: `oficina ${office}`, pairs: officePairs, critical: hasCritical(officePairs) })
        for (const asset of new Set(officePairs.map(pair => pair.asset_key))) {
          const assetPairs = officePairs.filter(pair => pair.asset_key === asset)
          report(`  activo ${asset}`, assetPairs, false)
          results.push({ label: `activo ${asset}`, pairs: assetPairs, critical: hasCritical(assetPairs) })
        }
      }
      console.log('\n## Umbrales (coherencia, no validación)')
      thresholds(results)
    }
    sweep('important_first')
    sweep('least_important_first')
  } finally {
    await payload.destroy()
  }
  process.exit(0)
}

main().catch(error => {
  console.error('Simulación falló.', error)
  process.exit(1)
})
