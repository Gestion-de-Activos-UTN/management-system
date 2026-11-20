import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPayload } from 'payload'
import config from '../../payload.config'
import { calculateRiskForScope, loadRiskInputs, recalculateRisk } from './recalculateRisk'
import { relationId } from '@/lib/relationId'
import { manualResult, seedRiskOrganization } from './risk-integration-seed'

// Integration test against Postgres: the pure engine is covered by unit tests; this checks the
// loader (queries, pagination, aging, tenant filtering) and the transactional persistence.

test('recalculateRisk: persists every applicable pair with its evidence and applies aging', async () => {
  const payload = await getPayload({ config })
  const { organization, office, server } = await seedRiskOrganization(payload)
  const ids = {
    organizationId: String(organization.id),
    officeId: String(office.id),
    assetId: String(server.id),
  }
  const future = new Date(Date.now() + 86_400_000).toISOString()
  const past = new Date(Date.now() - 86_400_000).toISOString()
  await payload.create({
    collection: 'compliance-results',
    overrideAccess: true,
    data: manualResult(ids, 'A.8.2', 0, future),
  })
  // Expired answer: must not revive A.8.13 (aging, plan §3.10).
  await payload.create({
    collection: 'compliance-results',
    overrideAccess: true,
    data: manualResult(ids, 'A.8.13', 1, past),
  })
  // Another tenant with an asset and an answer that must never leak into this evaluation.
  const other = await seedRiskOrganization(payload)
  await payload.create({
    collection: 'compliance-results',
    overrideAccess: true,
    data: manualResult(
      {
        organizationId: String(other.organization.id),
        officeId: String(other.office.id),
        assetId: String(other.server.id),
      },
      'A.8.2',
      1,
      future
    ),
  })

  const evaluation = await recalculateRisk(payload, { organizationId: ids.organizationId })

  const contributions = await payload.find({
    collection: 'risk-contributions',
    overrideAccess: true,
    depth: 0,
    limit: 500,
    where: { evaluation: { equals: evaluation.id } },
  })
  // Server under essential policy: 5 automatic + 9 question controls (see reference fixtures).
  assert.equal(contributions.totalDocs, 14)
  assert.ok(contributions.docs.every(row => row.asset_key === `asset:${ids.assetId}`))

  const byControl = new Map(contributions.docs.map(row => [row.control_key, row]))
  const privileged = byControl.get('A.8.2')!
  assert.equal(privileged.status, 'non_compliant')
  assert.equal(privileged.compliance, 0)
  assert.equal(privileged.criticality_weight, 8) // critical server, B pura
  assert.equal(privileged.asset_office, ids.officeId)
  assert.equal((privileged.evidence as { kind: string }).kind, 'answer')
  assert.equal(byControl.get('A.8.13')!.status, 'not_evaluable')
  assert.equal(byControl.get('A.8.13')!.reason_code, 'answer_missing')
  assert.equal(byControl.get('A.8.16')!.status, 'compliant')
  // No services observed with complete coverage: compliant within the baseline (D25).
  assert.equal(byControl.get('A.8.21')!.status, 'compliant')

  assert.equal(evaluation.policy_key, 'essential')
  assert.equal(evaluation.engine_version, 3)
  const counts = evaluation.counts as { pairs: Record<string, number>; assets: { in_scope: number } }
  assert.equal(counts.assets.in_scope, 1)
  // A.5.9, A.5.12 and A.8.16 stay out of the index counts.
  assert.equal(Object.values(counts.pairs).reduce((sum, value) => sum + value, 0), 11)
})

test('recalculateRisk: an office evaluation still inherits organization-level answers', async () => {
  const payload = await getPayload({ config })
  const { organization, office, server } = await seedRiskOrganization(payload)
  await payload.create({
    collection: 'compliance-results',
    overrideAccess: true,
    data: {
      ...manualResult(
        {
          organizationId: String(organization.id),
          officeId: String(office.id),
          assetId: String(server.id),
        },
        'A.5.25',
        1,
        new Date(Date.now() + 86_400_000).toISOString()
      ),
      office: null,
      asset: null,
    },
  })

  const evaluation = await recalculateRisk(payload, {
    organizationId: String(organization.id),
    officeId: String(office.id),
  })
  const events = await payload.find({
    collection: 'risk-contributions',
    overrideAccess: true,
    depth: 0,
    limit: 1,
    where: {
      and: [{ evaluation: { equals: evaluation.id } }, { control_key: { equals: 'A.5.25' } }],
    },
  })
  assert.equal(events.docs[0]?.status, 'compliant')
})

test('recalculateRisk: ignores answers from another policy and stamps the evidence read time', async () => {
  const payload = await getPayload({ config })
  const { organization, office, server } = await seedRiskOrganization(payload)
  const ids = {
    organizationId: String(organization.id),
    officeId: String(office.id),
    assetId: String(server.id),
  }
  // Answered under reinforced, then the organization moved to essential (seed): must not count.
  await payload.create({
    collection: 'compliance-results',
    overrideAccess: true,
    data: {
      ...manualResult(ids, 'A.8.2', 1, new Date(Date.now() + 86_400_000).toISOString()),
      policy_key: 'reinforced',
    },
  })
  const now = new Date(Date.now() - 60_000)

  const evaluation = await recalculateRisk(payload, { organizationId: ids.organizationId, now })

  assert.equal(new Date(evaluation.evaluated_at).getTime(), now.getTime())
  const privileged = await payload.find({
    collection: 'risk-contributions',
    overrideAccess: true,
    depth: 0,
    limit: 1,
    where: {
      and: [{ evaluation: { equals: evaluation.id } }, { control_key: { equals: 'A.8.2' } }],
    },
  })
  assert.equal(privileged.docs[0]?.status, 'not_evaluable')
})

test('recalculateRisk: los activos de una oficina inactiva no cuentan en el riesgo de la organización', async () => {
  const payload = await getPayload({ config })
  const { organization } = await seedRiskOrganization(payload)
  const organizationId = String(organization.id)
  const branch = await payload.create({
    collection: 'offices',
    overrideAccess: true,
    data: { organization: organizationId, name: 'Sucursal' },
  })
  const laptop = await payload.create({
    collection: 'non-network-assets',
    overrideAccess: true,
    data: {
      alias: 'Notebook de la sucursal',
      asset_category: 'computer',
      criticality: 'high',
      office: String(branch.id),
      organization: organizationId,
    } as never,
  })
  const laptopKeys = async () => {
    const evaluation = await recalculateRisk(payload, { organizationId })
    const contributions = await payload.find({
      collection: 'risk-contributions',
      overrideAccess: true,
      depth: 0,
      pagination: false,
      where: { evaluation: { equals: evaluation.id } },
    })
    return contributions.docs.filter(row => row.asset_key === `manual:${laptop.id}`).length
  }

  assert.ok((await laptopKeys()) > 0, 'con la oficina activa, la notebook cuenta')
  await payload.update({
    collection: 'offices',
    id: branch.id,
    overrideAccess: true,
    data: { is_active: false },
  })
  assert.equal(await laptopKeys(), 0, 'con la oficina inactiva, deja de contar')
  // La evaluación de la oficina inactiva sigue devolviendo una evaluación (vacía): la usan el
  // snapshot y el job; el job no la pide para oficinas inactivas.
  const empty = await recalculateRisk(payload, { organizationId, officeId: String(branch.id) })
  assert.ok(empty.id)
})

test('calculateRiskForScope: an assigned subset leaves out assets without office, of other offices or inactive ones', async () => {
  const payload = await getPayload({ config })
  const { organization, office, server } = await seedRiskOrganization(payload)
  const organizationId = String(organization.id)
  const make = (name: string) =>
    payload.create({ collection: 'offices', overrideAccess: true, data: { organization: organizationId, name } })
  const [other, inactive] = await Promise.all([make('Otra'), make('Inactiva')])
  // Assets require an agent; an asset without office keeps the main office's agent.
  const agentOf = async (officeId: string) =>
    String(
      (
        await payload.create({
          collection: 'agents',
          overrideAccess: true,
          context: { systemJob: true },
          data: { id: `agent-${Math.random().toString(36).slice(2)}`, office: officeId },
        })
      ).id
    )
  const agents = { other: await agentOf(String(other.id)), inactive: await agentOf(String(inactive.id)) }
  const asset = (suffix: string, officeId: string | null, agent: string, cidr: string) =>
    payload.create({
      collection: 'assets',
      overrideAccess: true,
      context: { systemJob: true },
      data: {
        asset_id: `scope-${suffix}-${Math.random().toString(36).slice(2)}`,
        agent,
        office: officeId,
        organization: organizationId,
        ip: '10.0.0.20',
        status: 'active',
        identified: false,
        authorization_status: 'pending',
        criticality: 'critical',
        last_observed_cidr: cidr,
        asset_coverage: { port_scan: 'complete', service_detection: 'complete' },
        services: [],
      } as never,
    })
  const outside = await Promise.all([
    asset('none', null, String(relationId(server.agent)), '10.0.0.0/24'),
    asset('other', String(other.id), agents.other, '10.0.0.0/24'),
    asset('inactive', String(inactive.id), agents.inactive, '10.0.0.0/24'),
  ])
  await payload.update({ collection: 'offices', id: inactive.id, overrideAccess: true, data: { is_active: false } })
  const outsideKeys = new Set(outside.map(doc => `asset:${doc.id}`))

  for (const officeIds of [[String(office.id)], [String(office.id), String(inactive.id)]]) {
    const scoped = await calculateRiskForScope(payload, { organizationId, officeIds })
    assert.deepEqual([...new Set(scoped.pairs.map(pair => pair.asset_key))], [`asset:${server.id}`])
    assert.equal(scoped.evaluation.counts.assets.in_scope, 1)
    assert.equal(scoped.evaluation.counts.assets.unidentified, 0)
    assert.deepEqual(
      scoped.evaluation.context.office_visibility.map(item => item.office_id),
      [String(office.id)]
    )
    // The server is critical, but no unidentified neighbour is in scope: no shared-CIDR notice.
    assert.deepEqual(scoped.evaluation.context.shared_cidr, [])
    const inputs = await loadRiskInputs(payload, { organizationId, officeIds })
    assert.ok(inputs.networkHistory.every(row => !outsideKeys.has(row.asset_key)))
  }
})
