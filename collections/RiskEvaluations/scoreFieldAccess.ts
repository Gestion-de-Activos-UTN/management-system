import type { FieldAccess } from 'payload'
import { bandVisible, scoreVisible, type ConfidenceBand } from '@/domain/risk/constants'
import { relationId } from '@/lib/relationId'

// Field-level twin of the DTO masking in endpoints/risk.ts: REST reads (and relationship population,
// e.g. inventory-snapshots.risk_score) must not expose numbers the risk endpoint hides. Server code
// reads with overrideAccess and is unaffected.
const confidenceOf = (doc: unknown) =>
  (doc as { confidence?: ConfidenceBand } | undefined)?.confidence

export const whenScoreVisible: FieldAccess = ({ doc }) => {
  const confidence = confidenceOf(doc)
  return Boolean(confidence && scoreVisible(confidence))
}

export const whenBandVisible: FieldAccess = ({ doc }) => {
  const confidence = confidenceOf(doc)
  return Boolean(confidence && bandVisible(confidence))
}

/** For risk-contributions: visibility follows the parent evaluation, looked up once per request. */
export const whenEvaluationScoreVisible: FieldAccess = async ({ doc, req }) => {
  const evaluation = (doc as { evaluation?: unknown } | undefined)?.evaluation
  if (!evaluation) return false
  const id = relationId(evaluation)
  const cache = ((req.context.riskEvaluationConfidence as Map<string, Promise<boolean>>) ??=
    new Map())
  if (!cache.has(id))
    cache.set(
      id,
      req.payload
        .findByID({
          collection: 'risk-evaluations',
          id,
          overrideAccess: true,
          depth: 0,
          select: { confidence: true },
        })
        .then(row => scoreVisible(row.confidence))
        .catch(() => false)
    )
  return cache.get(id)!
}
