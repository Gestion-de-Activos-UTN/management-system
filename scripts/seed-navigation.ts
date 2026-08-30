import { getPayload } from 'payload'
import type { Payload, PayloadRequest } from 'payload'
import config from '../payload.config'
import { createOrgWithAdmin } from '../domain/organizations/createOrgWithAdmin'

// Único script de esta fase (modo navegación de solo lectura): siembra, en una sola
// transacción atómica, los 4 roles base, una organización demo completa (Settings +
// Subscription + Office vía createOrgWithAdmin) y un usuario por rol. Credenciales fijas
// a propósito — es un seed de navegación/demo, no producción.
const ORG_NAME = 'Demo Organization'

const CREDENTIALS = {
  org_admin: { email: 'org-admin@siam.com', password: 'Password2026' },
  org_viewer: { email: 'org-viewer@siam.com', password: 'Password2026' },
  office_manager: { email: 'main-manager@siam.com', password: 'Password2026' },
  office_manager_secondary: { email: 'secondary-manager@siam.com', password: 'Password2026' },
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

async function ensureSecondaryOfficeAndAdminScope(
  payload: Payload,
  req: PayloadRequest,
  organizationId: string
) {
  const officesResult = await payload.find({
    collection: 'offices',
    where: {
      and: [{ organization: { equals: organizationId } }, { name: { equals: 'Secondary Office' } }],
    },
    overrideAccess: true,
    req,
    limit: 1,
  })
  const secondaryOffice =
    officesResult.docs[0] ??
    (await payload.create({
      collection: 'offices',
      overrideAccess: true,
      req,
      data: { organization: organizationId, name: 'Secondary Office' },
    }))

  const adminUsers = await payload.find({
    collection: 'users',
    where: { email: { equals: CREDENTIALS.org_admin.email } },
    overrideAccess: true,
    req,
    limit: 1,
  })
  const adminUser = adminUsers.docs[0]
  if (!adminUser) throw new Error('No se encontró el usuario org-admin demo')

  const memberships = await payload.find({
    collection: 'organization-memberships',
    where: {
      and: [{ user: { equals: adminUser.id } }, { organization: { equals: organizationId } }],
    },
    overrideAccess: true,
    req,
    limit: 1,
  })
  const membership = memberships.docs[0]
  if (!membership) throw new Error('No se encontró la membership del org-admin demo')

  const officeIds = Array.from(
    new Set([
      ...(membership.offices ?? []).map(office =>
        String(typeof office === 'object' ? office.id : office)
      ),
      String(secondaryOffice.id),
    ])
  )
  if (officeIds.length !== (membership.offices ?? []).length) {
    await payload.update({
      collection: 'organization-memberships',
      id: membership.id,
      overrideAccess: true,
      req,
      data: { offices: officeIds },
    })
  }

  const officeManagerRole = await findRoleBySlug(payload, req, 'office_manager')
  const secondaryManagers = await payload.find({
    collection: 'users',
    where: { email: { equals: CREDENTIALS.office_manager_secondary.email } },
    overrideAccess: true,
    req,
    limit: 1,
  })
  const secondaryManager =
    secondaryManagers.docs[0] ??
    (await payload.create({
      collection: 'users',
      overrideAccess: true,
      req,
      data: {
        email: CREDENTIALS.office_manager_secondary.email,
        password: CREDENTIALS.office_manager_secondary.password,
        name: 'Secondary Office Manager',
      },
    }))
  const secondaryMemberships = await payload.find({
    collection: 'organization-memberships',
    where: {
      and: [
        { user: { equals: secondaryManager.id } },
        { organization: { equals: organizationId } },
      ],
    },
    overrideAccess: true,
    req,
    limit: 1,
  })
  if (secondaryMemberships.docs[0]) {
    await payload.update({
      collection: 'organization-memberships',
      id: secondaryMemberships.docs[0].id,
      overrideAccess: true,
      req,
      data: {
        offices: [secondaryOffice.id],
        role: officeManagerRole.id,
        is_active: true,
        status: 'active',
      },
    })
  } else {
    await payload.create({
      collection: 'organization-memberships',
      overrideAccess: true,
      req,
      data: {
        user: secondaryManager.id,
        organization: organizationId,
        offices: [secondaryOffice.id],
        role: officeManagerRole.id,
        status: 'active',
        is_active: true,
      },
    })
  }
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
    const transactionID = await payload.db.beginTransaction()
    const req = { transactionID } as PayloadRequest
    try {
      await ensureSecondaryOfficeAndAdminScope(payload, req, String(existingOrg.docs[0].id))
      if (transactionID) await payload.db.commitTransaction(transactionID)
    } catch (err) {
      if (transactionID) await payload.db.rollbackTransaction(transactionID)
      throw err
    }
    console.log(`'${ORG_NAME}' ya existe — se reparó el alcance del org-admin demo.`)
    printCredentials()
    process.exit(0)
  }

  const transactionID = await payload.db.beginTransaction()
  const req = { transactionID } as PayloadRequest

  try {
    for (const role of ROLES) await findOrCreateRole(payload, req, role)

    const {
      organization,
      office,
      user: orgAdminUser,
    } = await createOrgWithAdmin(
      payload,
      {
        organizationName: ORG_NAME,
        industry: 'Tecnología',
        adminEmail: CREDENTIALS.org_admin.email,
        adminPassword: CREDENTIALS.org_admin.password,
        adminName: 'Org Admin',
      },
      req
    )

    const secondaryOffice = await payload.create({
      collection: 'offices',
      overrideAccess: true,
      req,
      data: { organization: organization.id, name: 'Secondary Office' },
    })

    await payload.update({
      collection: 'organization-memberships',
      where: { user: { equals: orgAdminUser.id } },
      overrideAccess: true,
      req,
      data: { offices: [office.id, secondaryOffice.id] },
    })

    const orgViewerRole = await findRoleBySlug(payload, req, 'org_viewer')
    const viewerUser = await payload.create({
      collection: 'users',
      overrideAccess: true,
      req,
      data: {
        email: CREDENTIALS.org_viewer.email,
        password: CREDENTIALS.org_viewer.password,
        name: 'Org Viewer',
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
        name: 'Main Office Manager',
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

    const secondaryOfficeManagerUser = await payload.create({
      collection: 'users',
      overrideAccess: true,
      req,
      data: {
        email: CREDENTIALS.office_manager_secondary.email,
        password: CREDENTIALS.office_manager_secondary.password,
        name: 'Secondary Office Manager',
      },
    })
    await payload.create({
      collection: 'organization-memberships',
      overrideAccess: true,
      req,
      data: {
        user: secondaryOfficeManagerUser.id,
        organization: organization.id,
        offices: [secondaryOffice.id],
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
