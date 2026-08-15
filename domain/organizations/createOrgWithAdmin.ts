import type { Payload, PayloadRequest } from 'payload'
import { defaultFeatures } from '../subscriptions/features'

export interface CreateOrgWithAdminInput {
  organizationName: string
  industry: string
  adminEmail: string
  adminPassword: string
  adminName: string
}

// Implementa documentation/04-bootstrap-creation-order.md pasos 1-5 (Organization ->
// Settings+Subscription (paralelo) -> link back -> Office -> Role lookup) dentro de una
// transacción real de Payload/Postgres — reemplaza el rollback manual en cascada del doc por
// una transacción de DB (más simple, estrictamente más seguro: ningún paso queda a medias
// visible para otra conexión). Los pasos 6-10 del doc (UserInvitation -> Auth0 signup) se
// reemplazan por creación directa de User+Membership, ya que no hay Auth0 ni invitaciones
// en esta fase.
//
// Composable: si se pasa `externalReq` con una transacción ya activa, la reusa (no abre/cierra
// transacción propia) — necesario para que scripts/seed-navigation.ts pueda envolver esto y
// pasos adicionales (un segundo user, un Admin) en una única transacción atómica.
export async function createOrgWithAdmin(
  payload: Payload,
  input: CreateOrgWithAdminInput,
  externalReq?: PayloadRequest,
) {
  const ownsTransaction = !externalReq?.transactionID
  const transactionID = externalReq?.transactionID ?? (await payload.db.beginTransaction())
  const req = externalReq
    ? Object.assign(externalReq, { transactionID })
    : ({ transactionID } as PayloadRequest)

  try {
    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {name, is_active}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    const organization = await payload.create({
      collection: 'organizations',
      overrideAccess: true,
      req,
      data: { name: input.organizationName, is_active: true },
    })

    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {organization, industry, level, features}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    const [settings, subscription] = await Promise.all([
      payload.create({
        collection: 'organization-settings',
        overrideAccess: true,
        req,
        data: { organization: organization.id, industry: input.industry },
      }),
      payload.create({
        collection: 'subscriptions',
        overrideAccess: true,
        req,
        data: { organization: organization.id, level: 'custom', features: defaultFeatures() },
      }),
    ])

    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {settings, subscription}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    await payload.update({
      collection: 'organizations',
      id: organization.id,
      overrideAccess: true,
      req,
      data: { settings: settings.id, subscription: subscription.id },
    })

    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {organization, name}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    const office = await payload.create({
      collection: 'offices',
      overrideAccess: true,
      req,
      data: { organization: organization.id, name: 'Main Office' },
    })

    const orgAdminRoleResult = await payload.find({
      collection: 'roles',
      overrideAccess: true,
      req,
      where: { slug: { equals: 'org_admin' } },
      limit: 1,
    })
    const orgAdminRole = orgAdminRoleResult.docs[0]
    if (!orgAdminRole) {
      throw new Error('Role org_admin no sembrado — correr el seed de roles primero')
    }

    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {email, name}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    const user = await payload.create({
      collection: 'users',
      overrideAccess: true,
      req,
      data: { email: input.adminEmail, password: input.adminPassword, name: input.adminName },
    })

    // AUDIT: this action must emit an AuditLogs entry (user.invite, chain_hash over {user, organization, role}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    // NOTIFY: this event should trigger a Notification Bell entry for {the new org_admin user}
    // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
    await payload.create({
      collection: 'organization-memberships',
      overrideAccess: true,
      req,
      data: {
        user: user.id,
        organization: organization.id,
        offices: [office.id],
        role: orgAdminRole.id,
        status: 'active',
        is_active: true,
      },
    })
    // el hook afterChange de OrganizationMemberships enlaza user.organization_membership solo

    if (ownsTransaction && transactionID) await payload.db.commitTransaction(transactionID)
    return { organization, office, user }
  } catch (err) {
    if (ownsTransaction && transactionID) await payload.db.rollbackTransaction(transactionID)
    throw err
  }
}
