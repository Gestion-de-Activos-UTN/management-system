import { RISK_CONTROLS_V2, RISK_QUESTIONS_V2 } from './catalog-v2'
import type { RiskAssetType, RiskPolicyKey, QuestionScope } from './catalog-v2/types'
import type { Criticality, RiskSeverity } from './constants'
import type { ApplicableRiskPair, RiskPopulationAsset, RiskUnitKind } from './engine'
import {
  classificationEfficacy,
  evaluateNetworkServices,
  exposureFromServices,
  inventoryEfficacy,
  scopeMultiplier,
  shadowItEfficacy,
  undeterminedExposureAlerts,
  type ServiceClassification,
} from './automatic-evidence'

export type RiskInputAsset = {
  key: string // `asset:<id>` or `manual:<id>`
  source: 'network' | 'manual'
  office_id: string
  risk_type: RiskAssetType | null
  criticality: Criticality
  identified: boolean
  authorization_status: 'authorized' | 'unauthorized' | 'pending'
  has_owner: boolean
  cidr: string | null
  excluded: boolean
  network: { current: boolean; complete: boolean; services: ServiceClassification[] } | null
}

/** A current (not expired) human answer already combined per control (plan §3.3). */
export type RiskAnswerEvidence = {
  control_key: string
  asset_key: string | null
  office_id: string | null
  efficacy: number | null
  evaluated_at: string
  reason_code: string
}

export type RiskOfficeMonitoring = {
  office_id: string
  efficacy: number | null
  reason_code: string
}

type QuestionControl = {
  key: string
  severity: RiskSeverity
  scope: QuestionScope
  asset_types: ReadonlySet<RiskAssetType> | null // null = every asset with a risk type
}

function questionControls(policy: RiskPolicyKey): QuestionControl[] {
  return RISK_CONTROLS_V2.flatMap(control => {
    const questions = RISK_QUESTIONS_V2.filter(
      question => question.control_key === control.key && question.policies.includes(policy)
    )
    if (!questions.length) return []
    const unrestricted = questions.some(question => !question.asset_types)
    return [
      {
        key: control.key,
        severity: control.severity as RiskSeverity,
        scope: questions[0].scope,
        asset_types: unrestricted
          ? null
          : new Set(questions.flatMap(question => question.asset_types ?? [])),
      },
    ]
  })
}

/**
 * Plan §3.2: builds every applicable (asset, control) pair before filtering evaluability, so missing
 * or expired evidence stays in the coverage denominator as `not_evaluable`.
 */
export function buildRiskPairs(input: {
  organizationId: string
  policy: RiskPolicyKey
  assets: readonly RiskInputAsset[]
  answers: readonly RiskAnswerEvidence[]
  monitoring: readonly RiskOfficeMonitoring[]
}) {
  const answers = [...input.answers].sort((a, b) => b.evaluated_at.localeCompare(a.evaluated_at))
  const monitoring = new Map(input.monitoring.map(item => [item.office_id, item]))
  const unknownCidrs = new Set(
    input.assets.flatMap(asset =>
      asset.source === 'network' && !asset.identified && asset.cidr ? [asset.cidr] : []
    )
  )
  const controls = questionControls(input.policy)
  const pairs: ApplicableRiskPair[] = []

  for (const asset of input.assets) {
    // Unidentified or pending assets add no evaluable weight until confirmed (Reglas Globales §5.2).
    const unconfirmed =
      asset.source === 'network' && (!asset.identified || asset.authorization_status === 'pending')
    const gate = (efficacy: number | null, reason: string) =>
      unconfirmed
        ? { efficacy: null, reason_code: 'asset_unconfirmed' }
        : { efficacy, reason_code: reason }
    const exposure = asset.network
      ? exposureFromServices(asset.network)
      : { exposure: 'medium' as const, source: 'default_unknown' as const }
    const base = {
      asset_id: asset.key,
      criticality: asset.criticality,
      exposure: exposure.exposure,
      exposure_source: exposure.source,
      scope_multiplier: scopeMultiplier(asset.cidr, unknownCidrs),
    }
    const unit = (kind: RiskUnitKind) => ({
      unit_kind: kind,
      unit_id:
        kind === 'asset' ? asset.key : kind === 'office' ? asset.office_id : input.organizationId,
    })

    pairs.push(
      {
        ...base,
        ...unit('asset'),
        ...gate(
          inventoryEfficacy(asset.identified, asset.has_owner, asset.authorization_status),
          'inventory_completeness'
        ),
        control_key: 'A.5.9',
        severity: 'unknown',
        coverage_only: true,
      },
      {
        ...base,
        ...unit('asset'),
        ...gate(classificationEfficacy(asset.criticality), 'criticality_assignment'),
        control_key: 'A.5.12',
        severity: 'unknown',
        coverage_only: true,
      }
    )

    if (asset.source === 'network') {
      const services = evaluateNetworkServices(
        asset.network ?? { current: false, complete: false, services: [] }
      )
      const office = monitoring.get(asset.office_id)
      pairs.push(
        {
          ...base,
          ...unit('asset'),
          ...gate(
            shadowItEfficacy(asset.identified, asset.authorization_status),
            'authorization_status'
          ),
          control_key: 'A.8.20',
          severity: 'high',
        },
        {
          ...base,
          ...unit('asset'),
          ...gate(services.efficacy, services.reason_code),
          control_key: 'A.8.21',
          severity: services.severity,
          exposure: 'low', // plan §3.4: its severity already comes from the service rule
        },
        {
          ...base,
          ...unit('office'),
          ...gate(office?.efficacy ?? null, office?.reason_code ?? 'agent_missing'),
          control_key: 'A.8.16',
          severity: 'high',
        }
      )
    }

    if (!asset.risk_type) continue
    for (const control of controls) {
      if (control.asset_types && !control.asset_types.has(asset.risk_type)) continue
      // Own answer wins over office, office over organization (plan §3.2).
      const answer =
        answers.find(a => a.control_key === control.key && a.asset_key === asset.key) ??
        (control.scope === 'asset'
          ? undefined
          : (answers.find(
              a => a.control_key === control.key && !a.asset_key && a.office_id === asset.office_id
            ) ?? answers.find(a => a.control_key === control.key && !a.asset_key && !a.office_id)))
      pairs.push({
        ...base,
        ...unit(control.scope),
        ...gate(answer?.efficacy ?? null, answer?.reason_code ?? 'answer_missing'),
        control_key: control.key,
        severity: control.severity,
        excluded: asset.excluded,
      })
    }
  }

  const population: RiskPopulationAsset[] = input.assets.map(asset => ({
    asset_id: asset.key,
    criticality: asset.criticality,
    identified: asset.identified,
    authorization_status: asset.authorization_status,
  }))
  const alerts = undeterminedExposureAlerts(
    input.assets
      .filter(asset => asset.source === 'network')
      .map(asset => ({
        id: asset.key,
        cidr: asset.cidr,
        identified: asset.identified,
        criticality: asset.criticality,
      }))
  )
  return { pairs, population, alerts }
}
