import type { Payload, PayloadRequest } from 'payload'
import { defaultFeatures } from '../subscriptions/features'
import { getSubscriptionLimits, type SubscriptionLevel } from '../subscriptions/limits'
import { reconcileAssessmentInstance } from '../assessments/reconcileAssessmentInstance'
import { AdminDomainError } from './admin-actions'

export interface CreateOrgWithAdminInput {
  organizationName: string
  industry: string
  industryDetails?: string
  adminEmail: string
  adminPassword: string
  adminName: string
  /** Basic por omisión para conservar los seeds existentes. La UI de StaffPortal siempre lo envía. */
  plan?: SubscriptionLevel
  officeProvinceId?: string
  officeDepartmentId?: string | null
  /** Nombre de la primera oficina; por defecto "Casa central". */
  officeName?: string
}

// Alta completa en una sola transacción de Payload/Postgres: Organization -> Settings +
// Subscription -> vínculo de vuelta -> Office -> Role -> User + Membership del primer OrgAdmin.
// Ningún paso queda a medias visible para otra conexión, y un fallo revierte todo. No hay
// invitaciones: el usuario se crea directamente con la autenticación nativa de Payload.
//
// Composable: si se pasa `externalReq` con una transacción ya activa, la reusa (no abre/cierra
// transacción propia) — necesario para que scripts/seed-navigation.ts pueda envolver esto y
// pasos adicionales (un segundo user, un Admin) en una única transacción atómica.
export async function createOrgWithAdmin(
  payload: Payload,
  input: CreateOrgWithAdminInput,
  externalReq?: PayloadRequest
) {
  const ownsTransaction = !externalReq?.transactionID
  const transactionID = externalReq?.transactionID ?? (await payload.db.beginTransaction())
  const req = externalReq
    ? Object.assign(externalReq, { transactionID })
    : ({ transactionID } as PayloadRequest)

  try {
    const plan = input.plan ?? 'basic'
    const subscriptionLimits = getSubscriptionLimits(plan)

    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {name, is_active}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    const organization = await payload.create({
      collection: 'organizations',
      overrideAccess: true,
      req,
      data: { name: input.organizationName, is_active: true },
    })

    // AUDIT: this action must emit an AuditLogs entry (chain_hash over {organization, industry, industry_details, level, features}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    const [settings, subscription] = await Promise.all([
      payload.create({
        collection: 'organization-settings',
        overrideAccess: true,
        req,
        data: {
          organization: organization.id,
          industry: input.industry,
          ...(input.industryDetails ? { industry_details: input.industryDetails } : {}),
          assessment_policy_key: 'essential',
          assessment_policy_version: 2,
          assessment_policy_selected_at: new Date().toISOString(),
        },
      }),
      payload.create({
        collection: 'subscriptions',
        overrideAccess: true,
        req,
        data: {
          organization: organization.id,
          level: plan,
          max_offices: subscriptionLimits.max_offices,
          user_limits: subscriptionLimits.user_limits,
          features: defaultFeatures(),
        },
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
      data: {
        organization: organization.id,
        is_active: true,
        name: input.officeName ?? 'Casa central',
        ...(input.officeProvinceId ? { province_id: input.officeProvinceId } : {}),
        ...(input.officeDepartmentId ? { department_id: input.officeDepartmentId } : {}),
      },
    })

    await reconcileAssessmentInstance(
      payload,
      {
        scope: 'organization',
        id: String(organization.id),
        organizationId: String(organization.id),
        is_active: organization.is_active ?? true,
      },
      'initial',
      req
    )
    await reconcileAssessmentInstance(
      payload,
      {
        scope: 'office',
        id: String(office.id),
        organizationId: String(organization.id),
        is_active: true,
      },
      'initial',
      req
    )

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

    const adminEmail = input.adminEmail.trim().toLowerCase()
    const existingUser = await payload.find({
      collection: 'users',
      where: { email: { equals: adminEmail } },
      overrideAccess: true,
      req,
      depth: 0,
      limit: 1,
    })
    if (existingUser.docs.length) {
      throw new AdminDomainError('email_unavailable', 409, 'Ya existe una cuenta con ese correo.')
    }

    // AUDIT: this action must emit an AuditLogs entry (user.create, chain_hash over {email, name}, previous hash for this organization_id)
    // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
    const user = await payload.create({
      collection: 'users',
      overrideAccess: true,
      req,
      data: {
        email: adminEmail,
        password: input.adminPassword,
        name: input.adminName,
        status: 'active',
      },
    })

    // AUDIT: this action must emit an AuditLogs entry (user.create, chain_hash over {user, organization, role}, previous hash for this organization_id)
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
