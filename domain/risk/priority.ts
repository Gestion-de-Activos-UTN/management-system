import type { AnswerEvidence } from './answer-evidence'
import { RISK_CONDITIONAL_RULES_V2, RISK_QUESTIONS_V2 } from './catalog-v2'
import type { RiskAssetType, RiskQuestionV2 } from './catalog-v2/types'
import type { DeficiencyPair } from './deficiency-pairs'

// Policy from propuesta-prioridades-y-parametros.md §4–§6. Decides what to attend first; it never
// changes compliance, the index or its band.

export type Priority = 'low' | 'medium' | 'high' | 'critical'
export const PRIORITY_RANK: Record<Priority, number> = { low: 0, medium: 1, high: 2, critical: 3 }
export const maxPriority = (a: Priority, b: Priority): Priority => (PRIORITY_RANK[a] >= PRIORITY_RANK[b] ? a : b)

export type Reason = {
  key: string
  list: 'deficiency' | 'pending'
  class: 'deficiency' | 'improvement' | 'verification' | 'missing_information' | 'review_pending'
  priority: Priority | null // always null in 'pending'
  reason_code: string
  source:
    | { kind: 'answer'; question_key: string; option_key: string }
    | { kind: 'check'; check_key: string; service_key?: string }
  subordinate_to?: string
  adjustments: string[]
}

type Rule = { priority: Priority; class: 'deficiency' | 'improvement' | 'verification' }
const low: Rule = { priority: 'low', class: 'improvement' }
const medium: Rule = { priority: 'medium', class: 'deficiency' }
const high: Rule = { priority: 'high', class: 'deficiency' }
const verify: Rule = { priority: 'medium', class: 'verification' }

/** Propuesta §4, one entry per scored option; null = the option raises no reason. */
export const ANSWER_PRIORITY: Readonly<Record<string, Readonly<Record<string, Rule | null>>>> = {
  'A.5.15.individual_accounts': { yes: null, no: medium },
  'A.5.15.access_revocation': { yes: null, no: high },
  'A.5.15.periodic_review': { yes: null, no: low },
  'A.5.25.event_records': { formal: null, informal: low, none: medium },
  'A.7.9.physical_protection': { encrypted_and_locked: null, locked_only: medium, none: high },
  'A.7.9.remote_actions': { managed: null, none: low }, // workstation default; mobile via TYPE_OVERRIDES
  'A.8.1.exclusive_use': { work_only: null, mostly_work: low, shared: medium },
  'A.8.2.privileged_access': { exclusive_authorized: null, multiple_as_needed: verify, generic_or_default: high },
  'A.8.5.unlock': { biometric_or_token: null, strong_password: low, simple_pin: verify, none: high },
  'A.8.5.idle_lock': { under_3m: null, between_3m_10m: low, over_10m: medium, none: medium },
  'A.8.7.protection_active': { centrally_managed: null, locally_managed: low, none: high },
  'A.8.7.protection_updates': { automatic_central: null, automatic_local: low, manual: medium, none: high },
  'A.8.8.vendor_support': { supported_updated: null, supported_pending: medium, unsupported: high },
  'A.8.9-20.default_password': { changed: null, default: high },
  'A.8.9-20.firmware': { automatic: null, on_failure: low, none: medium },
  'A.8.13.backup': { corporate_cloud: null, local_with_backup: low, personal_cloud: medium, local_only: high },
  'A.8.15.audit_logs': { centralized: null, local: low, none: medium },
  'A.8.19.software_installation': { restricted: null, warning_only: low, direct: medium },
  'A.8.22.guest_wifi': { yes: null, no: medium },
  'A.8.22.network_zones': { yes: null, no: low },
}

type OptionRef = { question_key: string; option_key: string; asset_types?: readonly RiskAssetType[] }

/** §5.2: replaces the base priority for the listed asset types only. */
export const TYPE_OVERRIDES: ReadonlyArray<OptionRef & { priority: Priority }> = [
  { question_key: 'A.7.9.remote_actions', option_key: 'none', asset_types: ['mobile'], priority: 'medium' },
]

/** §5.1: floor `high` on an asset rated high/critical, own evidence only. simple_pin left out on purpose. */
export const CRITICALITY_ELEVATION: readonly OptionRef[] = [
  { question_key: 'A.7.9.physical_protection', option_key: 'locked_only' },
  { question_key: 'A.8.1.exclusive_use', option_key: 'shared' },
  { question_key: 'A.8.2.privileged_access', option_key: 'multiple_as_needed' },
  { question_key: 'A.8.7.protection_updates', option_key: 'manual' },
  { question_key: 'A.8.8.vendor_support', option_key: 'supported_pending' },
  { question_key: 'A.8.9-20.firmware', option_key: 'none' },
  { question_key: 'A.8.13.backup', option_key: 'personal_cloud' },
  { question_key: 'A.8.19.software_installation', option_key: 'direct' },
]

/** §5.3: floor `critical` on an asset rated critical, own evidence only. */
export const CRITICAL_COMBINATIONS: readonly OptionRef[] = [
  { question_key: 'A.8.2.privileged_access', option_key: 'generic_or_default' },
  { question_key: 'A.8.9-20.default_password', option_key: 'default' },
  { question_key: 'A.8.5.unlock', option_key: 'none', asset_types: ['server'] },
  { question_key: 'A.8.13.backup', option_key: 'local_only', asset_types: ['server', 'information_repository'] },
]

const SPECIAL_OPTIONS = new Set(['unknown', 'not_applicable'])

/**
 * Fails fast on import, like validateRiskCatalogV2: a typo in any list would otherwise silently
 * disable a rule, and an option left without policy would hide a known deficiency.
 */
export function validatePriorityPolicy(
  policy: {
    answers: typeof ANSWER_PRIORITY
    overrides: typeof TYPE_OVERRIDES
    elevation: typeof CRITICALITY_ELEVATION
    critical: typeof CRITICAL_COMBINATIONS
  } = {
    answers: ANSWER_PRIORITY,
    overrides: TYPE_OVERRIDES,
    elevation: CRITICALITY_ELEVATION,
    critical: CRITICAL_COMBINATIONS,
  },
  questions: readonly RiskQuestionV2[] = RISK_QUESTIONS_V2
): void {
  const byKey = new Map(questions.map(question => [question.key, question]))
  for (const question of questions) {
    const entry = policy.answers[question.key]
    if (!entry) throw new Error(`Priority policy misses question ${question.key}`)
    for (const option of question.options) {
      if (SPECIAL_OPTIONS.has(option.key)) continue
      if (!(option.key in entry))
        throw new Error(`Priority policy misses option ${question.key}=${option.key}`)
      // Traceability (Plan §4): every known value below 1 must explain itself; full compliance never does.
      if (option.efficacy !== null && option.efficacy < 1 && !entry[option.key])
        throw new Error(`Priority policy leaves ${question.key}=${option.key} unexplained`)
      if (option.efficacy === 1 && entry[option.key])
        throw new Error(`Priority policy raises a reason on compliant ${question.key}=${option.key}`)
    }
  }
  for (const [key, entry] of Object.entries(policy.answers)) {
    const question = byKey.get(key)
    if (!question) throw new Error(`Priority policy names missing question ${key}`)
    for (const option of Object.keys(entry))
      if (!question.options.some(item => item.key === option) || SPECIAL_OPTIONS.has(option))
        throw new Error(`Priority policy names missing option ${key}=${option}`)
  }
  const checkRef = (ref: OptionRef, list: string) => {
    const question = byKey.get(ref.question_key)
    if (!question?.options.some(option => option.key === ref.option_key))
      throw new Error(`${list} names missing option ${ref.question_key}=${ref.option_key}`)
    for (const type of ref.asset_types ?? [])
      if (!question.asset_types?.includes(type))
        throw new Error(`${list} names type ${type} outside ${ref.question_key}`)
    if (!policy.answers[ref.question_key]?.[ref.option_key])
      throw new Error(`${list} targets ${ref.question_key}=${ref.option_key}, which raises no reason`)
  }
  for (const ref of policy.overrides) checkRef(ref, 'Type override')
  for (const ref of policy.critical) checkRef(ref, 'Critical combination')
  for (const ref of policy.elevation) {
    checkRef(ref, 'Criticality elevation')
    if (policy.answers[ref.question_key]![ref.option_key]!.priority !== 'medium')
      throw new Error(`Criticality elevation of ${ref.question_key}=${ref.option_key} needs a medium base`)
  }
}
validatePriorityPolicy()

const matches = (ref: OptionRef, questionKey: string, optionKey: string, type: RiskAssetType | null) =>
  ref.question_key === questionKey &&
  ref.option_key === optionKey &&
  (!ref.asset_types || (type !== null && ref.asset_types.includes(type)))

/** One key per declaration: an inherited answer reaching N assets is still one reason. */
function reasonPrefix(pair: DeficiencyPair, answer: AnswerEvidence): string {
  if (answer.origin === 'asset') return pair.asset_key
  if (answer.origin === 'office') {
    if (!answer.office_id) throw new Error(`Office answer ${answer.result_id} has no office`)
    return `office:${answer.office_id}`
  }
  return 'organization'
}

// The question scope a control's pairs take (the catalog guarantees one per control and policy).
const CONTROL_SCOPE = new Map(RISK_QUESTIONS_V2.map(question => [question.control_key, question.scope]))

function answerReasons(pair: DeficiencyPair, answer: AnswerEvidence): Reason[] {
  const prefix = reasonPrefix(pair, answer)
  const own = answer.origin === 'asset'
  const keyOf = (questionKey: string, optionKey: string) =>
    `${prefix}|${pair.control_key}|${questionKey}:${optionKey}`
  const options = new Map(answer.sub.map(sub => [sub.question_key, sub.option_key]))
  // §5.6: a force_zero rule makes its target a context of the triggering answer, never a second alarm.
  const forcedBy = new Map<string, string>()
  for (const rule of RISK_CONDITIONAL_RULES_V2)
    if (rule.operation === 'force_zero' && answer.applied_rules.includes(rule.key))
      forcedBy.set(rule.target_question_key, keyOf(rule.input_question_keys[0], rule.when_option_key))

  const reasons: Reason[] = []
  for (const [questionKey, optionKey] of options) {
    if (!optionKey || optionKey === 'not_applicable') continue
    const source = { kind: 'answer' as const, question_key: questionKey, option_key: optionKey }
    if (optionKey === 'unknown') {
      if (forcedBy.has(questionKey)) continue // value fixed by its dependency (§9.5)
      reasons.push({
        key: keyOf(questionKey, optionKey),
        list: 'pending',
        class: 'missing_information',
        priority: null,
        reason_code: 'answer_unknown',
        source,
        adjustments: [],
      })
      continue
    }
    const rule = ANSWER_PRIORITY[questionKey]?.[optionKey]
    if (!rule) continue
    const adjustments: string[] = []
    const override = TYPE_OVERRIDES.find(ref => matches(ref, questionKey, optionKey, pair.asset_type))
    let priority = override?.priority ?? rule.priority
    if (override) adjustments.push('type_override')
    // Floors compose by max, so their order never matters and critical always prevails.
    if (
      own &&
      (pair.criticality === 'high' || pair.criticality === 'critical') &&
      CRITICALITY_ELEVATION.some(ref => matches(ref, questionKey, optionKey, pair.asset_type))
    ) {
      priority = maxPriority(priority, 'high')
      adjustments.push('criticality_elevation')
    }
    if (
      own &&
      pair.criticality === 'critical' &&
      CRITICAL_COMBINATIONS.some(ref => matches(ref, questionKey, optionKey, pair.asset_type))
    ) {
      priority = maxPriority(priority, 'critical')
      adjustments.push('critical_combination')
    }
    reasons.push({
      key: keyOf(questionKey, optionKey),
      list: 'deficiency',
      class: rule.class,
      priority,
      reason_code: `answer_${optionKey}`,
      source,
      ...(forcedBy.has(questionKey) ? { subordinate_to: forcedBy.get(questionKey) } : {}),
      adjustments,
    })
  }
  // A not-evaluable answer without sub-answers (legacy snapshot) still has to be explained.
  if (!reasons.length && pair.compliance === null && pair.applicability === 'applicable')
    reasons.push(pending(`${prefix}|${pair.control_key}|not_evaluable`, 'not_evaluable', {
      kind: 'check',
      check_key: `manual:${pair.control_key}`,
    }))
  return reasons
}

const pending = (
  key: string,
  reasonCode: string,
  source: Reason['source'],
  reasonClass: Reason['class'] = 'missing_information'
): Reason => ({ key, list: 'pending', class: reasonClass, priority: null, reason_code: reasonCode, source, adjustments: [] })

/** Reasons of one pair, by evidence kind (propuesta §4–§6). */
export function pairReasons(pair: DeficiencyPair): Reason[] {
  const evidence = pair.evidence
  // An unconfirmed asset is one survey item on A.5.9, not one pending per control (Plan §4.1).
  if (pair.reason_code === 'asset_unconfirmed')
    return pair.control_key === 'A.5.9'
      ? [pending(`${pair.asset_key}|A.5.9|asset_unconfirmed`, 'asset_unconfirmed', { kind: 'check', check_key: 'asset.inventory.complete' })]
      : []
  if (pair.applicability === 'not_applicable') return []
  switch (evidence.kind) {
    case 'answer':
      return answerReasons(pair, evidence.answer)
    case 'answer_missing': {
      const scope = CONTROL_SCOPE.get(pair.control_key)
      const prefix =
        scope === 'organization' ? 'organization' : scope === 'office' ? `office:${pair.asset_office_id}` : pair.asset_key
      return [pending(`${prefix}|${pair.control_key}|answer_missing`, 'answer_missing', { kind: 'check', check_key: `manual:${pair.control_key}` })]
    }
    case 'automatic': {
      const source = { kind: 'check' as const, check_key: evidence.check_key }
      const key = `${pair.asset_key}|${pair.control_key}|${evidence.check_key}`
      // A.8.16 is one notice per office from context.office_visibility, never one per asset.
      if (pair.control_key === 'A.8.16' || pair.compliance === 1) return []
      if (pair.control_key === 'A.8.20' && pair.compliance === 0)
        return [{ key, list: 'deficiency', class: 'deficiency', priority: 'high', reason_code: 'asset_unauthorized', source, adjustments: [] }]
      return pair.compliance === null ? [pending(key, pair.reason_code, source)] : []
    }
    case 'network': {
      // Blocked by offline or coverage: one survey item, no per-service reasons.
      if (!evidence.findings.length)
        return pair.compliance === null
          ? [pending(`${pair.asset_key}|A.8.21|${pair.reason_code}`, pair.reason_code, { kind: 'check', check_key: 'network.baseline' })]
          : []
      return evidence.findings.map(finding => {
        const key = `${pair.asset_key}|A.8.21|${finding.service_key}|${finding.check_key}`
        const source = { kind: 'check' as const, check_key: finding.check_key, service_key: finding.service_key }
        // Propuesta §6: a valid baseline breach is high, never elevated by criticality.
        if (finding.baseline === 'prohibited')
          return { key, list: 'deficiency', class: 'deficiency', priority: 'high', reason_code: finding.reason_code, source, adjustments: [] }
        return pending(key, finding.reason_code, source, finding.baseline === 'review' ? 'review_pending' : 'missing_information')
      })
    }
  }
}

/** Highest non-subordinate deficiency reason; subordinate ones are context, not extra deficiencies. */
export function pairPriority(reasons: readonly Reason[]): Priority | null {
  return reasons
    .filter(reason => reason.list === 'deficiency' && !reason.subordinate_to)
    .reduce<Priority | null>((top, reason) => (top ? maxPriority(top, reason.priority!) : reason.priority), null)
}

/** Unique deficiency reasons by priority: an inherited declaration counts once, subordinates never. */
export function countDeficiencies(pairs: readonly { reasons: readonly Reason[] }[]): Record<Priority, number> {
  const unique = new Map<string, Priority>()
  for (const pair of pairs)
    for (const reason of pair.reasons)
      if (reason.list === 'deficiency' && !reason.subordinate_to) unique.set(reason.key, reason.priority!)
  const counts: Record<Priority, number> = { low: 0, medium: 0, high: 0, critical: 0 }
  for (const priority of unique.values()) counts[priority] += 1
  return counts
}

/** Pending services as unique asset|service keys: «3 servicios pendientes en 2 equipos». */
export function countPendingServices(pairs: readonly { asset_key: string; reasons: readonly Reason[] }[]) {
  const services = new Set<string>()
  const assets = new Set<string>()
  for (const pair of pairs)
    for (const reason of pair.reasons)
      if (reason.list === 'pending' && reason.source.kind === 'check' && reason.source.service_key) {
        services.add(`${pair.asset_key}|${reason.source.service_key}`)
        assets.add(pair.asset_key)
      }
  return { services: services.size, assets: assets.size }
}
