import type { Payload } from 'payload'

// Shared seed for risk integration tests (not a test file, so importing it registers no tests).

const suffix = () => Math.random().toString(36).slice(2)

export async function seedRiskOrganization(payload: Payload) {
  const organization = await payload.create({
    collection: 'organizations',
    overrideAccess: true,
    data: { name: `Risk ${suffix()}` },
  })
  await Promise.all([
    payload.create({
      collection: 'organization-settings',
      overrideAccess: true,
      data: {
        organization: organization.id,
        industry: 'Professional services',
        assessment_policy_key: 'essential',
        assessment_policy_version: 2,
        assessment_policy_selected_at: new Date().toISOString(),
      },
    }),
    payload.create({
      collection: 'subscriptions',
      overrideAccess: true,
      data: {
        organization: organization.id,
        level: 'premium',
        user_limits: {},
        max_offices: 10,
        features: { security_assessments: true, risk_score: true },
      },
    }),
  ])
  const office = await payload.create({
    collection: 'offices',
    overrideAccess: true,
    data: { organization: organization.id, name: 'Main' },
  })
  const agent = await payload.create({
    collection: 'agents',
    overrideAccess: true,
    context: { systemJob: true },
    data: {
      id: `agent-${suffix()}`,
      office: office.id,
      last_heartbeat_at: new Date().toISOString(),
    },
  })
  const server = await payload.create({
    collection: 'assets',
    overrideAccess: true,
    context: { systemJob: true },
    data: {
      asset_id: `a-${suffix()}`,
      agent: agent.id,
      office: office.id,
      organization: organization.id,
      ip: '10.0.0.10',
      status: 'active',
      identified: true,
      confirmed_type: 'server',
      authorization_status: 'authorized',
      criticality: 'critical',
      last_observed_cidr: '10.0.0.0/24',
      asset_coverage: { port_scan: 'complete', service_detection: 'complete' },
      services: [],
    },
  })
  return { organization, office, server }
}

export function manualResult(
  input: { organizationId: string; officeId: string; assetId: string },
  controlKey: string,
  efficacy: number,
  validUntil: string
) {
  return {
    organization: input.organizationId,
    office: input.officeId,
    asset: input.assetId,
    control_key: controlKey,
    check_key: `manual:${controlKey}.fixture`,
    status: efficacy === 1 ? ('compliant' as const) : ('non_compliant' as const),
    severity: 'medium' as const, // ignored by the engine: severity comes from the catalog
    policy_key: 'essential' as const,
    policy_version: 2,
    evaluated_at: new Date().toISOString(),
    valid_until: validUntil,
    reason_code: 'fixture',
    explanation: 'Integration fixture.',
    evidence_snapshot: { evaluation_effect: { combined_efficacy: efficacy } },
  }
}

const ROLES = {
  org_admin: { name: 'Org Admin', rank: 1, scope: 'organization' },
  office_manager: { name: 'Office Manager', rank: 5, scope: 'organization_office' },
} as const

async function roleId(payload: Payload, slug: keyof typeof ROLES) {
  const found = await payload.find({
    collection: 'roles',
    where: { slug: { equals: slug } },
    overrideAccess: true,
    limit: 1,
  })
  if (found.docs[0]) return found.docs[0].id
  const role = await payload.create({
    collection: 'roles',
    overrideAccess: true,
    data: { slug, ...ROLES[slug], is_platform_role: false },
  })
  return role.id
}

export async function member(
  payload: Payload,
  organizationId: string,
  offices: string[],
  slug: keyof typeof ROLES
) {
  const user = await payload.create({
    collection: 'users',
    overrideAccess: true,
    data: {
      name: `Risk ${slug}`,
      email: `risk-${slug}-${Math.random().toString(36).slice(2)}@test.local`,
      password: 'x'.repeat(12),
    },
  })
  await payload.create({
    collection: 'organization-memberships',
    overrideAccess: true,
    data: {
      user: user.id,
      organization: organizationId,
      offices,
      role: await roleId(payload, slug),
      status: 'active',
      is_active: true,
    },
  })
  return String(user.id)
}
