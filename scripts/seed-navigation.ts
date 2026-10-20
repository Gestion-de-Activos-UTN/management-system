import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import type { Payload, PayloadRequest, Where } from 'payload'
import config from '../payload.config'
import { createOrgWithAdmin } from '../domain/organizations/createOrgWithAdmin'
import { reconcileAssessmentInstance } from '../domain/assessments/reconcileAssessmentInstance'
import { initializeSeedPayload } from './seed-payload'
import {
  DEMO_OFFICES,
  LIFECYCLE_DEMO_MANAGER,
  LIFECYCLE_DEMO_OFFICE,
  type DemoOffice,
} from '../domain/demo/demo-offices'
import { PORTAL_MESSAGE_TEMPLATES } from '../modules/portal-messages/templates'

// Único script de esta fase (modo navegación de solo lectura): siembra, en una sola
// transacción atómica, los 4 roles base, una organización demo completa (Settings +
// Subscription + Office vía createOrgWithAdmin), un usuario por rol y los datos de
// Administración (ubicación de oficinas, una oficina inactiva, personas desactivadas o en
// incorporación). Credenciales fijas a propósito — es un seed de navegación/demo, no producción.
const ORG_NAME = 'Demo Organization'

// Personas demo con nombres reales; el email es la credencial y no cambia. `legacyName` es el
// nombre genérico que usaban antes: sólo ese se reemplaza al reparar una base ya sembrada.
const CREDENTIALS = {
  org_admin: {
    email: 'org-admin@siam.com',
    password: 'Password2026',
    name: 'Valeria Rossi',
    legacyName: 'Org Admin',
  },
  org_viewer: {
    email: 'org-viewer@siam.com',
    password: 'Password2026',
    name: 'Diego Martínez',
    legacyName: 'Org Viewer',
  },
  office_manager: {
    email: 'main-manager@siam.com',
    password: 'Password2026',
    name: 'Sofía Herrera',
    legacyName: 'Main Office Manager',
  },
  office_manager_secondary: {
    email: 'secondary-manager@siam.com',
    password: 'Password2026',
    name: 'Joaquín Benítez',
    legacyName: 'Secondary Office Manager',
  },
  platform_admin: {
    email: 'platform-admin@siam.com',
    password: 'Password2026',
    name: 'Carolina Paz',
    legacyName: 'Platform Admin',
  },
}

/** Reemplaza los nombres genéricos de una base sembrada antes; respeta los que se editaron. */
async function renameLegacyDemoPeople(payload: Payload, req: PayloadRequest) {
  for (const [key, person] of Object.entries(CREDENTIALS)) {
    const collection = key === 'platform_admin' ? 'admins' : 'users'
    const found = await payload.find({
      collection,
      where: { email: { equals: person.email } },
      overrideAccess: true,
      req,
      limit: 1,
    })
    const doc = found.docs[0]
    if (doc && doc.name === person.legacyName) {
      await payload.update({
        collection,
        id: doc.id,
        overrideAccess: true,
        req,
        data: { name: person.name },
      })
    }
  }
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
    // Lector limitado a sus oficinas, igual que office_manager (access/rbac/permissions.ts::hasOrgWideScope).
    scope: 'organization_office',
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

async function ensurePortalWelcomeMessage(payload: Payload, req: PayloadRequest) {
  const existing = await payload.find({
    collection: 'portal-messages',
    where: { template_key: { equals: 'portal_welcome' } },
    overrideAccess: true,
    req,
    limit: 1,
  })
  if (existing.docs[0]) return false

  const welcome = PORTAL_MESSAGE_TEMPLATES.find(template => template.key === 'portal_welcome')!
  await payload.create({
    collection: 'portal-messages',
    overrideAccess: true,
    req,
    data: {
      title: welcome.title,
      description: welcome.description,
      message_type: 'notice',
      template_key: welcome.key,
      scope: 'global',
      target_organizations: [],
      target_kind: 'all',
      target_roles: [],
      target_users: [],
      linked_section: null,
      linked_entity_type: null,
      linked_entity: null,
      expires_at: null,
      is_active: true,
      delivery_version: 1,
    },
  })
  return true
}

// Personas sin credenciales impresas: sólo existen para mostrar estados en Administración →
// Usuarios. Lucía administra Córdoba (y Rosario) hasta que seed:demo cierra esa oficina y la
// desactiva; la otra todavía se está incorporando.
const ONBOARDING_VIEWER = { email: 'new-viewer@siam.com', name: 'Martín Gómez' }

async function findOneDoc<C extends 'offices' | 'users'>(
  payload: Payload,
  req: PayloadRequest,
  collection: C,
  where: Where
) {
  const found = await payload.find({ collection, where, overrideAccess: true, req, limit: 1 })
  return found.docs[0]
}

async function ensureSeedMember(
  payload: Payload,
  req: PayloadRequest,
  input: {
    organizationId: string
    email: string
    name: string
    officeIds: string[]
    roleSlug: 'office_manager' | 'org_viewer'
    membership: { is_active: boolean; status: 'active' | 'onboarding' }
  }
) {
  // Si ya existe no se toca: un administrador pudo haberla reactivado o editado.
  if (await findOneDoc(payload, req, 'users', { email: { equals: input.email } })) return
  const role = await findRoleBySlug(payload, req, input.roleSlug)
  const user = await payload.create({
    collection: 'users',
    overrideAccess: true,
    req,
    data: {
      email: input.email,
      // Sin login en la demo: contraseña aleatoria que nadie conoce.
      password: randomUUID(),
      name: input.name,
      status: input.membership.is_active ? 'active' : 'inactive',
    },
  })
  await payload.create({
    collection: 'organization-memberships',
    overrideAccess: true,
    req,
    data: {
      user: user.id,
      organization: input.organizationId,
      offices: input.officeIds,
      role: role.id,
      ...input.membership,
    },
  })
}

/**
 * Busca una oficina demo por su nombre actual o el heredado ("Main Office"/"Secondary Office").
 * Si todavía tiene el heredado lo reemplaza, y completa la ubicación si falta; nunca pisa lo que
 * se haya editado a mano.
 */
async function findDemoOffice(
  payload: Payload,
  req: PayloadRequest,
  organizationId: string,
  demo: DemoOffice
) {
  const office = await findOneDoc(payload, req, 'offices', {
    and: [
      { organization: { equals: organizationId } },
      { name: { in: [demo.name, demo.legacyName] } },
    ],
  })
  if (!office) return undefined
  const repair = {
    ...(office.name === demo.legacyName ? { name: demo.name } : {}),
    ...(!office.province_id
      ? { province_id: demo.province_id, department_id: demo.department_id }
      : {}),
  }
  if (!Object.keys(repair).length) return office
  return payload.update({
    collection: 'offices',
    id: office.id,
    overrideAccess: true,
    req,
    data: repair,
  })
}

/**
 * Datos de Administración: ubicación de las oficinas, la oficina que seed:demo cierra (Córdoba)
 * y personas en otros estados. Idempotente y no destructivo: sólo completa lo que falta.
 */
async function ensureAdministrationDemo(
  payload: Payload,
  req: PayloadRequest,
  organizationId: string
) {
  await findDemoOffice(payload, req, organizationId, DEMO_OFFICES.main)
  const secondaryOffice = await findDemoOffice(payload, req, organizationId, DEMO_OFFICES.secondary)

  // Nace activa con su revisión: seed:demo la desactiva con el flujo real (deactivateOffice).
  const existingLifecycleOffice = await findOneDoc(payload, req, 'offices', {
    and: [
      { organization: { equals: organizationId } },
      { name: { equals: LIFECYCLE_DEMO_OFFICE.name } },
    ],
  })
  const lifecycleOffice =
    existingLifecycleOffice ??
    (await payload.create({
      collection: 'offices',
      overrideAccess: true,
      req,
      data: { organization: organizationId, ...LIFECYCLE_DEMO_OFFICE, is_active: true },
    }))
  if (!existingLifecycleOffice) {
    await reconcileAssessmentInstance(
      payload,
      { scope: 'office', id: String(lifecycleOffice.id), organizationId, is_active: true },
      'initial',
      req
    )
  }

  await ensureSeedMember(payload, req, {
    organizationId,
    ...LIFECYCLE_DEMO_MANAGER,
    officeIds: [
      String(lifecycleOffice.id),
      ...(secondaryOffice ? [String(secondaryOffice.id)] : []),
    ],
    roleSlug: 'office_manager',
    membership: { is_active: true, status: 'active' },
  })
  if (secondaryOffice) {
    await ensureSeedMember(payload, req, {
      organizationId,
      ...ONBOARDING_VIEWER,
      officeIds: [String(secondaryOffice.id)],
      roleSlug: 'org_viewer',
      membership: { is_active: true, status: 'onboarding' },
    })
  }
}

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
  const { legacyName: _, ...secondary } = DEMO_OFFICES.secondary
  let secondaryOffice = await findDemoOffice(payload, req, organizationId, DEMO_OFFICES.secondary)
  if (!secondaryOffice) {
    secondaryOffice = await payload.create({
      collection: 'offices',
      overrideAccess: true,
      req,
      data: { organization: organizationId, is_active: true, ...secondary },
    })
    await reconcileAssessmentInstance(
      payload,
      {
        scope: 'office',
        id: String(secondaryOffice.id),
        organizationId,
        is_active: true,
      },
      'initial',
      req
    )
  }

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
        name: CREDENTIALS.office_manager_secondary.name,
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
  for (const [role, { email, password, name }] of Object.entries(CREDENTIALS)) {
    console.log(`  ${role}: ${name} · ${email} / ${password}`)
  }
}

export async function seedNavigation(payload: Payload) {
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
      await ensureAdministrationDemo(payload, req, String(existingOrg.docs[0].id))
      await renameLegacyDemoPeople(payload, req)
      await ensurePortalWelcomeMessage(payload, req)
      if (transactionID) await payload.db.commitTransaction(transactionID)
    } catch (err) {
      if (transactionID) await payload.db.rollbackTransaction(transactionID)
      throw err
    }
    console.log(`'${ORG_NAME}' ya existe — se reparó el alcance del org-admin demo.`)
    printCredentials()
    return
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
        adminName: CREDENTIALS.org_admin.name,
        officeName: DEMO_OFFICES.main.name,
      },
      req
    )

    const { legacyName: _, ...secondary } = DEMO_OFFICES.secondary
    const secondaryOffice = await payload.create({
      collection: 'offices',
      overrideAccess: true,
      req,
      data: { organization: organization.id, is_active: true, ...secondary },
    })
    await reconcileAssessmentInstance(
      payload,
      {
        scope: 'office',
        id: String(secondaryOffice.id),
        organizationId: String(organization.id),
        is_active: true,
      },
      'initial',
      req
    )

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
        name: CREDENTIALS.org_viewer.name,
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
        name: CREDENTIALS.office_manager.name,
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
        name: CREDENTIALS.office_manager_secondary.name,
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
        name: CREDENTIALS.platform_admin.name,
        role: platformAdminRole.id,
      },
    })

    await ensureAdministrationDemo(payload, req, String(organization.id))
    await ensurePortalWelcomeMessage(payload, req)

    if (transactionID) await payload.db.commitTransaction(transactionID)
  } catch (err) {
    if (transactionID) await payload.db.rollbackTransaction(transactionID)
    throw err
  }

  console.log('Seed de navegación OK.')
  printCredentials()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  initializeSeedPayload(config)
    .then(async payload => {
      await seedNavigation(payload)
      await payload.destroy()
      process.exit(0)
    })
    .catch(err => {
      console.error(err)
      process.exit(1)
    })
}
