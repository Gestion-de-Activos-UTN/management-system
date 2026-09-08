import { QUESTION_CATALOG } from './question-catalog'
import type { PolicyDefinition, PolicyKey } from './catalog-types'

const questionKeysFor = (policy: PolicyKey) =>
  QUESTION_CATALOG.filter(question => question.policies.includes(policy as never)).map(
    question => question.key
  )

const riskWeights = {
  severity: { low: 1, medium: 2, high: 4, critical: 8 },
  criticality: { low: 0.75, medium: 1, high: 1.5, critical: 2, unknown: 1 },
  controls: {
    'A.5.15': 1.25,
    'A.8.7': 1.5,
    'A.8.13': 1.5,
    'A.8.20': 1.25,
    'A.8.21': 1.25,
  },
  default_control: 1,
} as const

export const POLICY_CATALOG = [
  {
    key: 'essential',
    version: 1,
    name: 'Essential',
    review_frequency_days: 365,
    description: 'A short yearly review focused on the routines every small business should know.',
    question_keys: questionKeysFor('essential'),
    risk_weights: riskWeights,
  },
  {
    key: 'reinforced',
    version: 1,
    name: 'Reinforced',
    review_frequency_days: 180,
    description:
      'A more frequent review with added checks for businesses that need closer follow-up.',
    question_keys: questionKeysFor('reinforced'),
    risk_weights: riskWeights,
  },
] as const satisfies readonly PolicyDefinition[]
