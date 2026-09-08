import { SCANNED_ASSET_TYPE_VALUES } from '@/domain/assets/asset-types'
import {
  ANSWER_VALUES,
  ASSESSMENT_SCOPES,
  POLICY_KEYS,
  type AssessmentCatalog,
} from './catalog-types'

const assertUnique = (values: readonly string[], label: string) => {
  const duplicate = values.find((value, index) => values.indexOf(value) !== index)
  if (duplicate) throw new Error(`Assessment catalog has duplicate ${label}: ${duplicate}`)
}

export function validateAssessmentCatalog(catalog: AssessmentCatalog): void {
  if (!Number.isInteger(catalog.catalog_version) || catalog.catalog_version < 1) {
    throw new Error('Assessment catalog version must be a positive integer')
  }

  assertUnique(
    catalog.controls.map(item => item.key),
    'control key'
  )
  assertUnique(
    catalog.questions.map(item => item.key),
    'question key'
  )
  assertUnique(
    catalog.policies.map(item => item.key),
    'policy key'
  )
  assertUnique(
    catalog.network_rules.map(item => item.key),
    'network rule key'
  )

  const controls = new Map(catalog.controls.map(control => [control.key, control]))
  const questions = new Map(catalog.questions.map(question => [question.key, question]))
  const policies = new Map(catalog.policies.map(policy => [policy.key, policy]))
  const assetTypes = new Set<string>(SCANNED_ASSET_TYPE_VALUES)

  for (const expectedPolicy of POLICY_KEYS) {
    if (!policies.has(expectedPolicy)) throw new Error(`Missing required policy: ${expectedPolicy}`)
  }

  for (const question of catalog.questions) {
    if (!ASSESSMENT_SCOPES.includes(question.scope)) {
      throw new Error(`Question ${question.key} has invalid scope: ${question.scope}`)
    }
    if (!question.prompt.trim() || !question.help_text.trim()) {
      throw new Error(`Question ${question.key} requires prompt and help text`)
    }
    if (question.scope !== 'asset' && question.applies_to_asset_types?.length) {
      throw new Error(`Question ${question.key} can only filter asset types at asset scope`)
    }
    if (question.scope === 'asset' && !question.applies_to_asset_types?.length) {
      throw new Error(`Asset question ${question.key} must declare applicable asset types`)
    }
    for (const assetType of question.applies_to_asset_types ?? []) {
      if (!assetTypes.has(assetType))
        throw new Error(`Question ${question.key} has invalid asset type: ${assetType}`)
    }
    for (const controlKey of question.control_keys) {
      const control = controls.get(controlKey)
      if (!control)
        throw new Error(`Question ${question.key} references missing control: ${controlKey}`)
      if (!control.scopes.includes(question.scope)) {
        throw new Error(
          `Question ${question.key} scope ${question.scope} is incompatible with ${controlKey}`
        )
      }
    }
    for (const policyKey of question.policies) {
      if (!policies.has(policyKey))
        throw new Error(`Question ${question.key} references missing policy: ${policyKey}`)
      if (
        !Number.isInteger(question.validity_days[policyKey]) ||
        question.validity_days[policyKey] < 1
      ) {
        throw new Error(`Question ${question.key} requires positive validity for ${policyKey}`)
      }
    }
    for (const answer of ANSWER_VALUES) {
      if (!question.evaluation[answer])
        throw new Error(`Question ${question.key} has no evaluation for ${answer}`)
    }
    if (
      question.evaluation.unknown.status !== 'not_evaluable' ||
      question.evaluation.not_applicable.status !== 'not_evaluable'
    ) {
      throw new Error(`Question ${question.key} must keep unknown and not_applicable out of risk`)
    }
    for (const dependency of question.dependencies ?? []) {
      if (dependency.type === 'requires_question_answer') {
        const dependencyQuestion = questions.get(dependency.question_key)
        if (!dependencyQuestion)
          throw new Error(
            `Question ${question.key} depends on missing question: ${dependency.question_key}`
          )
        if (dependencyQuestion.scope !== question.scope)
          throw new Error(`Question ${question.key} has a cross-scope answer dependency`)
      }
      if (dependency.type === 'requires_confirmed_asset_type' && question.scope !== 'asset') {
        throw new Error(`Question ${question.key} has an asset-type dependency outside asset scope`)
      }
    }
  }

  for (const policy of catalog.policies) {
    const weights = [
      ...Object.values(policy.risk_weights.severity),
      ...Object.values(policy.risk_weights.criticality),
      ...Object.values(policy.risk_weights.controls),
      policy.risk_weights.default_control,
    ]
    if (weights.some(weight => !Number.isFinite(weight) || weight <= 0)) {
      throw new Error(`Policy ${policy.key} requires positive risk weights`)
    }
    assertUnique(policy.question_keys, `question in policy ${policy.key}`)
    for (const questionKey of policy.question_keys) {
      const question = questions.get(questionKey)
      if (!question)
        throw new Error(`Policy ${policy.key} references missing question: ${questionKey}`)
      if (!question.policies.includes(policy.key))
        throw new Error(
          `Policy ${policy.key} includes question ${questionKey} without reciprocal membership`
        )
    }
    for (const question of catalog.questions) {
      if (question.policies.includes(policy.key) && !policy.question_keys.includes(question.key)) {
        throw new Error(`Question ${question.key} is missing from policy ${policy.key}`)
      }
    }
  }

  for (const rule of catalog.network_rules) {
    if (!controls.has(rule.control_key))
      throw new Error(`Network rule ${rule.key} references missing control: ${rule.control_key}`)
    if (rule.minimum_confidence < 0 || rule.minimum_confidence > 10)
      throw new Error(`Network rule ${rule.key} has invalid confidence`)
    if (
      !rule.ports.length ||
      rule.ports.some(port => !Number.isInteger(port) || port < 0 || port > 65535)
    ) {
      throw new Error(`Network rule ${rule.key} has invalid ports`)
    }
  }
}
