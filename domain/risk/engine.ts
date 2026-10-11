import {
  CONTROL_RISK_CAP,
  COVERAGE_THRESHOLDS,
  CRITICALITY_WEIGHTS,
  EXPOSURE_WEIGHTS,
  SCORE_THRESHOLDS,
  SEVERE_CONCENTRATION_THRESHOLD,
  SEVERITY_WEIGHTS,
  SYSTEMIC_FAILURE_THRESHOLD,
  UNKNOWN_THRESHOLDS,
  type ConfidenceBand,
  type Criticality,
  type Exposure,
  type PairStatus,
  type RiskBand,
  type RiskSeverity,
} from './constants'

export type RiskUnitKind = 'asset' | 'office' | 'organization'

export type ApplicableRiskPair = {
  asset_id: string
  control_key: string
  criticality: Criticality
  severity: RiskSeverity
  exposure: Exposure
  exposure_source?: 'scan' | 'default_unknown'
  scope_multiplier: 1 | 1.5
  efficacy: number | null
  coverage_only?: boolean
  excluded?: boolean
  reason_code: string
  unit_kind: RiskUnitKind
  unit_id: string
}

export type RiskPopulationAsset = {
  asset_id: string
  criticality: Criticality
  identified: boolean
  authorization_status: 'authorized' | 'unauthorized' | 'pending'
}

export type RiskContribution = ApplicableRiskPair & {
  status: PairStatus
  coverage_weight: number
  inherent_risk: number | null
  residual_risk: number | null
}

export type ControlAggregate = {
  control_key: string
  residual_raw: number
  residual_capped: number
  capped: boolean
  systemic_failure: boolean
}

export type AssetRiskScore = {
  asset_id: string
  score: number | null
  band: RiskBand | null
  inherent_risk: number
  residual_risk: number
}

export type RiskEvaluationResult = {
  contributions: RiskContribution[]
  controls: ControlAggregate[]
  assets: AssetRiskScore[]
  riem: number
  rro_raw: number
  rro_adjusted: number
  score: number | null
  base_band: RiskBand | null
  final_band: RiskBand | null
  coverage: number
  confidence: ConfidenceBand
  effective_confidence: ConfidenceBand
  unknown_percentage: number
  severe_concentration_percentage: number
  severe_concentration: boolean
  critical_asset_alerts: Array<{ asset_id: string; control_key: string }>
  // `excluded` counts pairs; `excluded_assets` counts distinct assets.
  counts: Record<PairStatus | 'excluded' | 'excluded_assets' | 'unconfirmed_assets', number>
}

const groupBy = <T>(rows: readonly T[], key: (row: T) => string) => {
  const groups = new Map<string, T[]>()
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row])
  return groups
}

const statusFor = (efficacy: number | null): PairStatus =>
  efficacy === null
    ? 'not_evaluable'
    : efficacy === 1
      ? 'compliant'
      : efficacy === 0
        ? 'non_compliant'
        : 'partially_effective'

export const riskBandForScore = (score: number | null): RiskBand | null => {
  if (score === null) return null
  if (score >= SCORE_THRESHOLDS.critical) return 'critical'
  if (score >= SCORE_THRESHOLDS.high) return 'high'
  if (score >= SCORE_THRESHOLDS.medium) return 'medium'
  return 'low'
}

export const confidenceForCoverage = (coverage: number): ConfidenceBand => {
  if (coverage >= COVERAGE_THRESHOLDS.reliable) return 'reliable'
  if (coverage >= COVERAGE_THRESHOLDS.usable) return 'usable'
  if (coverage >= COVERAGE_THRESHOLDS.warning) return 'warning'
  if (coverage >= COVERAGE_THRESHOLDS.visible) return 'preliminary'
  return 'hidden'
}

export const degradeConfidence = (
  confidence: ConfidenceBand,
  unknownPercentage: number
): ConfidenceBand => {
  if (unknownPercentage < UNKNOWN_THRESHOLDS.degradeConfidence) return confidence
  const transitions: Record<ConfidenceBand, ConfidenceBand> = {
    reliable: 'usable',
    usable: 'warning',
    warning: 'preliminary',
    preliminary: 'preliminary',
    hidden: 'hidden',
  }
  return transitions[confidence]
}

const elevateBand = (band: RiskBand | null): RiskBand | null => {
  if (band === null || band === 'critical') return band
  return band === 'low' ? 'medium' : band === 'medium' ? 'high' : 'critical'
}

export function calculateRisk(
  pairs: readonly ApplicableRiskPair[],
  population: readonly RiskPopulationAsset[]
): RiskEvaluationResult {
  const contributions = pairs.map<RiskContribution>(pair => {
    const coverageWeight = CRITICALITY_WEIGHTS[pair.criticality]
    const efficacy = pair.excluded ? null : pair.efficacy
    const evaluable = efficacy !== null
    const inherent =
      evaluable && !pair.coverage_only
        ? CRITICALITY_WEIGHTS[pair.criticality] *
          pair.scope_multiplier *
          SEVERITY_WEIGHTS[pair.severity] *
          EXPOSURE_WEIGHTS[pair.exposure]
        : null
    return {
      ...pair,
      efficacy,
      status: statusFor(efficacy),
      coverage_weight: coverageWeight,
      inherent_risk: inherent,
      residual_risk: inherent === null ? null : inherent * (1 - efficacy!),
    }
  })

  const riskContributions = contributions.filter(item => item.inherent_risk !== null)
  const riem = riskContributions.reduce((sum, item) => sum + item.inherent_risk!, 0)
  const rroRaw = riskContributions.reduce((sum, item) => sum + item.residual_risk!, 0)
  const cap = CONTROL_RISK_CAP * riem
  const riskByControl = groupBy(riskContributions, item => item.control_key)
  // Systemic failure counts every applicable unit, including not_evaluable ones (Reglas §3.2).
  const applicableByControl = groupBy(
    contributions.filter(item => !item.coverage_only && !item.excluded),
    item => item.control_key
  )
  const controls = [...applicableByControl].map<ControlAggregate>(([controlKey, applicable]) => {
    const residualRaw = (riskByControl.get(controlKey) ?? []).reduce(
      (sum, item) => sum + item.residual_risk!,
      0
    )
    const units = groupBy(applicable, item => `${item.unit_kind}:${item.unit_id}`)
    const nonCompliant = [...units.values()].filter(rows =>
      rows.some(item => item.status === 'non_compliant')
    ).length
    const highSeverity = applicable.some(item => ['high', 'critical'].includes(item.severity))
    const systemic =
      highSeverity &&
      (applicable[0].unit_kind === 'organization'
        ? nonCompliant > 0
        : (nonCompliant / units.size) * 100 > SYSTEMIC_FAILURE_THRESHOLD)
    return {
      control_key: controlKey,
      residual_raw: residualRaw,
      residual_capped: Math.min(residualRaw, cap),
      capped: residualRaw > cap,
      systemic_failure: systemic,
    }
  })
  const rroAdjusted = controls.reduce((sum, item) => sum + item.residual_capped, 0)
  const score = riem === 0 ? null : (rroAdjusted / riem) * 100

  const applicableCoverage = contributions.filter(item => !item.excluded)
  const applicableWeight = applicableCoverage.reduce((sum, item) => sum + item.coverage_weight, 0)
  const evaluableWeight = applicableCoverage
    .filter(item => item.status !== 'not_evaluable')
    .reduce((sum, item) => sum + item.coverage_weight, 0)
  const coverage = applicableWeight === 0 ? 0 : (evaluableWeight / applicableWeight) * 100

  const populationWeight = population.reduce(
    (sum, asset) => sum + CRITICALITY_WEIGHTS[asset.criticality],
    0
  )
  const unknownWeight = population
    .filter(asset => !asset.identified || asset.authorization_status !== 'authorized')
    .reduce((sum, asset) => sum + CRITICALITY_WEIGHTS[asset.criticality], 0)
  const unknownPercentage = populationWeight === 0 ? 0 : (unknownWeight / populationWeight) * 100

  const severeResidual = riskContributions
    .filter(item => ['high', 'critical'].includes(item.severity))
    .reduce((sum, item) => sum + item.residual_risk!, 0)
  const severeConcentrationPercentage = rroRaw === 0 ? 0 : (severeResidual / rroRaw) * 100
  const severeConcentration = severeConcentrationPercentage > SEVERE_CONCENTRATION_THRESHOLD
  const baseBand = riskBandForScore(score)
  const finalBand = severeConcentration ? elevateBand(baseBand) : baseBand
  const confidence = confidenceForCoverage(coverage)

  const assets = [...groupBy(riskContributions, item => item.asset_id)].map<AssetRiskScore>(
    ([assetId, rows]) => {
      const inherent = rows.reduce((sum, item) => sum + item.inherent_risk!, 0)
      const residual = rows.reduce((sum, item) => sum + item.residual_risk!, 0)
      const assetScore = inherent === 0 ? null : (residual / inherent) * 100
      return {
        asset_id: assetId,
        score: assetScore,
        band: riskBandForScore(assetScore),
        inherent_risk: inherent,
        residual_risk: residual,
      }
    }
  )

  const criticalAssetAlerts = contributions
    .filter(
      item =>
        ['high', 'critical'].includes(item.criticality) &&
        item.severity === 'critical' &&
        item.status === 'non_compliant'
    )
    .map(item => ({ asset_id: item.asset_id, control_key: item.control_key }))

  return {
    contributions,
    controls,
    assets,
    riem,
    rro_raw: rroRaw,
    rro_adjusted: rroAdjusted,
    score,
    base_band: baseBand,
    final_band: finalBand,
    coverage,
    confidence,
    effective_confidence: degradeConfidence(confidence, unknownPercentage),
    unknown_percentage: unknownPercentage,
    severe_concentration_percentage: severeConcentrationPercentage,
    severe_concentration: severeConcentration,
    critical_asset_alerts: criticalAssetAlerts,
    counts: {
      compliant: applicableCoverage.filter(item => item.status === 'compliant').length,
      partially_effective: applicableCoverage.filter(item => item.status === 'partially_effective')
        .length,
      non_compliant: applicableCoverage.filter(item => item.status === 'non_compliant').length,
      not_evaluable: applicableCoverage.filter(item => item.status === 'not_evaluable').length,
      excluded: contributions.length - applicableCoverage.length,
      excluded_assets: new Set(
        contributions.filter(item => item.excluded).map(item => item.asset_id)
      ).size,
      // Assets behind Desconocido %: shown as a count, which is easier to act on than a weight.
      unconfirmed_assets: population.filter(
        asset => !asset.identified || asset.authorization_status !== 'authorized'
      ).length,
    },
  }
}
