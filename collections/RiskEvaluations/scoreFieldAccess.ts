import type { FieldAccess, PayloadRequest } from 'payload'
import {
  bandVisible,
  indexVisible,
  type IndexVisibility,
} from '@/domain/risk/deficiency-index'

// Field-level twin of the DTO masking in endpoints/risk.ts: REST reads (and relationship population,
// e.g. inventory-snapshots.risk_score) must not expose numbers the risk endpoint hides. Server code
// reads with overrideAccess and is unaffected.

/**
 * A partial `select` reaches field access without `visibility`; read it once per evaluation and
 * request instead of hiding a visible index by mistake. Fails closed.
 */
async function visibilityOf(doc: unknown, req: PayloadRequest): Promise<IndexVisibility | null> {
  const row = doc as { id?: string | number; visibility?: IndexVisibility } | undefined
  if (row?.visibility) return row.visibility
  if (row?.id === undefined) return null
  const id = String(row.id)
  const cache = ((req.context.riskEvaluationVisibility as Map<string, Promise<IndexVisibility | null>>) ??=
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
          select: { visibility: true },
        })
        .then(found => found.visibility ?? null)
        .catch(() => null)
    )
  return cache.get(id)!
}

export const whenIndexVisible: FieldAccess = async ({ doc, req }) =>
  indexVisible(await visibilityOf(doc, req))

export const whenBandVisible: FieldAccess = async ({ doc, req }) =>
  bandVisible(await visibilityOf(doc, req))
