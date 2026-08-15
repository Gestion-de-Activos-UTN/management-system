import { getPayload } from 'payload'
import type { Payload, PayloadRequest } from 'payload'
import config from '../payload.config'
import { createOrgWithAdmin } from '../domain/organizations/createOrgWithAdmin'

// Único script de esta fase (modo navegación de solo lectura): siembra, en una sola
// transacción atómica, los 4 roles base, una organización demo completa (Settings +
// Subscription + Office vía createOrgWithAdmin) y un usuario por rol. Credenciales fijas
// a propósito — es un seed de navegación/demo, no producción.
const ORG_NAME = 'Org Demo Navegación'

const CREDENTIALS = {
  org_admin: { email: 'org-admin@siam.com', password: 'Password2026' },
  org_viewer: { email: 'org-viewer@siam.com', password: 'Password2026' },
  office_manager: { email: 'office-manager@siam.com', password: 'Password2026' },
  platform_admin: { email: 'platform-admin@siam.com', password: 'Password2026' },
}

const ROLES = [
  {
    slug: 'platform_admin',
    name: 'Platform Admin',
    rank: 1,
    scope: 'platform',
    is_platform_role: true,
  },
  { slug: 'org_admin', name: 'Org Admin', rank: 1, scope: 'organization', is_platform_role: false },
  {
    slug: 'org_viewer',
    name: 'Org Viewer',
    rank: 10,
    scope: 'organization',
    is_platform_role: false,
  },
  {
    slug: 'office_manager',
    name: 'Office Manager',
    rank: 5,
    scope: 'organization_office',
    is_platform_role: false,
  },
] as const

async function findOrCreateRole(
  payload: Payload,
  req: PayloadRequest,
  role: (typeof ROLES)[number]
) {
  const existing = await payload.find({
    collection: 'roles',
    where: { slug: { equals: role.slug } },
    overrideAccess: true,
    req,
    limit: 1,
  })
  if (existing.docs[0]) return existing.docs[0]
  return payload.create({ collection: 'roles', overrideAccess: true, req, data: role })
}

async function findRoleBySlug(payload: Payload, req: PayloadRequest, slug: string) {
  const result = await payload.find({
    collection: 'roles',
    where: { slug: { equals: slug } },
    overrideAccess: true,
    req,
    limit: 1,
  })
  const role = result.docs[0]
  if (!role) throw new Error(`Role '${slug}' no encontrado`)
  return role
}

function printCredentials() {
  console.log('Credenciales de navegación (demo, no producción):')
  for (const [role, { email, password }] of Object.entries(CREDENTIALS)) {
    console.log(`  ${role}: ${email} / ${password}`)
  }
}

async function main() {
  const payload = await getPayload({ config })

  const existingOrg = await payload.find({
    collection: 'organizations',
    where: { name: { equals: ORG_NAME } },
    overrideAccess: true,
    limit: 1,
  })
  if (existingOrg.docs[0]) {
    console.log(`'${ORG_NAME}' ya existe — no se recrea nada.`)
    printCredentials()
    process.exit(0)
  }

  const transactionID = await payload.db.beginTransaction()
  const req = { transactionID } as PayloadRequest

  try {
    for (const role of ROLES) await findOrCreateRole(payload, req, role)

    const { organization, office } = await createOrgWithAdmin(
      payload,
      {
        organizationName: ORG_NAME,
        industry: 'Tecnología',
        adminEmail: CREDENTIALS.org_admin.email,
        adminPassword: CREDENTIALS.org_admin.password,
        adminName: 'Org Admin Demo',
      },
      req
    )

    const orgViewerRole = await findRoleBySlug(payload, req, 'org_viewer')
    const viewerUser = await payload.create({
      collection: 'users',
      overrideAccess: true,
      req,
      data: {
        email: CREDENTIALS.org_viewer.email,
        password: CREDENTIALS.org_viewer.password,
        name: 'Org Viewer Demo',
      },
    })
    await payload.create({
      collection: 'organization-memberships',
      overrideAccess: true,
      req,
      data: {
        user: viewerUser.id,
        organization: organization.id,
        offices: [office.id],
        role: orgViewerRole.id,
        status: 'active',
        is_active: true,
      },
    })

    const officeManagerRole = await findRoleBySlug(payload, req, 'office_manager')
    const officeManagerUser = await payload.create({
      collection: 'users',
      overrideAccess: true,
      req,
      data: {
        email: CREDENTIALS.office_manager.email,
        password: CREDENTIALS.office_manager.password,
        name: 'Office Manager Demo',
      },
    })
    await payload.create({
      collection: 'organization-memberships',
      overrideAccess: true,
      req,
      data: {
        user: officeManagerUser.id,
        organization: organization.id,
        offices: [office.id],
        role: officeManagerRole.id,
        status: 'active',
        is_active: true,
      },
    })

    const platformAdminRole = await findRoleBySlug(payload, req, 'platform_admin')
    await payload.create({
      collection: 'admins',
      overrideAccess: true,
      req,
      data: {
        email: CREDENTIALS.platform_admin.email,
        password: CREDENTIALS.platform_admin.password,
        role: platformAdminRole.id,
      },
    })

    if (transactionID) await payload.db.commitTransaction(transactionID)
  } catch (err) {
    if (transactionID) await payload.db.rollbackTransaction(transactionID)
    throw err
  }

  console.log('Seed de navegación OK.')
  printCredentials()
  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
