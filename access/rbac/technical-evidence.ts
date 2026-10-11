import type { FieldAccess, FieldHook } from 'payload'
import { getTenantContext } from '../tenant/resolveTenantContext'
import { canDo } from './permissions'
import { redactTechnicalEvidence } from '../../domain/inventories/technical-evidence'
export { redactTechnicalEvidence } from '../../domain/inventories/technical-evidence'

export const readTechnicalEvidence: FieldAccess = async ({ req }) => {
  const ctx = await getTenantContext(req)
  return Boolean(
    ctx?.isActive &&
    ctx.organizationId &&
    canDo(ctx.role, 'scan-reports', 'read_technical', ctx.organizationId)
  )
}

export const redactSnapshotForViewer: FieldHook = async ({ value, req, overrideAccess }) =>
  overrideAccess || (await readTechnicalEvidence({ req } as Parameters<FieldAccess>[0]))
    ? value
    : redactTechnicalEvidence(value)
