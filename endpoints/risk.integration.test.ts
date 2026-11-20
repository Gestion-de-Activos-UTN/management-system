import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPayload } from 'payload'
import type { Payload, PayloadRequest } from 'payload'
import config from '../payload.config'
import { persistRiskEvaluation } from '@/domain/risk/persistRiskEvaluation'
import type { DeficiencyPair } from '@/domain/risk/deficiency-pairs'
import type { EvaluationData } from '@/domain/risk/evaluation-from-pairs'
import type { IndexVisibility } from '@/domain/risk/deficiency-index'
import { recalculateRisk } from '@/domain/risk/recalculateRisk'
import { member, seedRiskOrganization } from '@/domain/risk/risk-integration-seed'
import type { LatestRiskResponse } from '@/modules/risk/service'
import { latestRiskEvaluationEndpoint } from './risk'

// IDOR checks: the organization always comes from the membership, never from the request, and
// an office outside the membership is rejected even inside the same organization.

const call = async (payload: Payload, userId: string, query = '') => {
  const response = await latestRiskEvaluationEndpoint.handler({
    payload,
    user: { id: userId, collection: 'users' },
    context: {},
    url: `http://localhost/api/v1/risk/latest${query}`,
  } as unknown as PayloadRequest)
  return { status: response.status, body: (await response.json()) as LatestRiskResponse }
}

test('risk endpoint: never returns another organization or an office outside the membership', async () => {
  const payload = await getPayload({ config })
  const a = await seedRiskOrganization(payload)
  const b = await seedRiskOrganization(payload)
  const orgA = String(a.organization.id)
  const officeA1 = String(a.office.id)
  const officeA2 = String(
    (
      await payload.create({
        collection: 'offices',
        overrideAccess: true,
        data: { organization: orgA, name: 'Second' },
      })
    ).id
  )
  const officeB = String(b.office.id)
  await recalculateRisk(payload, { organizationId: orgA })
  await recalculateRisk(payload, { organizationId: orgA, officeId: officeA1 })
  const evaluationB = await recalculateRisk(payload, { organizationId: String(b.organization.id) })

  const admin = await member(payload, orgA, [officeA1, officeA2], 'org_admin')
  const manager = await member(payload, orgA, [officeA1], 'office_manager')

  // Another tenant's office id is rejected, not silently answered with own data.
  assert.equal((await call(payload, admin, `?office_id=${officeB}`)).status, 403)
  // Same organization, office outside the membership.
  assert.equal((await call(payload, manager, `?office_id=${officeA2}`)).status, 403)
  // A client-supplied organization never overrides the membership.
  const spoofed = await call(payload, admin, `?organization=${b.organization.id}`)
  assert.equal(spoofed.status, 200)
  assert.notEqual(spoofed.body.evaluation?.id, String(evaluationB.id))

  const own = await call(payload, admin, '?list=pending&limit=50')
  assert.equal(own.status, 200)
  assert.ok(own.body.evaluation)
  assert.equal(own.body.list, 'pending')
  assert.ok(own.body.items.length > 0)
  assert.equal(own.body.totals.pending, own.body.pagination.totalDocs)
  for (const item of own.body.items) {
    const subject = item.subject
    // Labels are resolved only inside the caller's organization.
    if (subject.kind === 'asset') {
      assert.equal(subject.asset_key, `asset:${a.server.id}`)
      assert.equal(subject.asset_label, '10.0.0.10')
    } else if (subject.kind === 'organization') assert.equal(subject.id, orgA)
    else assert.ok([officeA1, officeA2].includes(subject.id))
  }
  assert.ok(own.body.evaluation!.top_assets.every(item => item.asset_key === `asset:${a.server.id}`))

  const office = await call(payload, manager, `?office_id=${officeA1}`)
  assert.equal(office.status, 200)
  assert.ok(office.body.evaluation)
})

test('risk endpoint: rejects invalid pagination instead of guessing', async () => {
  const payload = await getPayload({ config })
  const a = await seedRiskOrganization(payload)
  const admin = await member(payload, String(a.organization.id), [String(a.office.id)], 'org_admin')
  assert.equal((await call(payload, admin, '?page=0')).status, 400)
  assert.equal((await call(payload, admin, '?page=abc')).status, 400)
  assert.equal((await call(payload, admin, '?list=contributions')).status, 400)
  assert.equal((await call(payload, admin, '?limit=7')).status, 400)
})

// Hand-built evaluation: raw index, band and per-asset numbers exist whatever the visibility.
const handBuilt = (assetKey: string, visibility: IndexVisibility): { evaluation: EvaluationData; pairs: DeficiencyPair[] } => ({
  evaluation: {
    catalog_version: 2,
    engine_version: 3,
    policy_key: 'essential',
    index: 60,
    band: 'high',
    coverage: visibility === 'banded' ? 90 : 10,
    visibility,
    control_summary: [
      { control_key: 'A.8.2', importance: 8, deficiency: 1, coverage: 1, evaluated_pairs: 1, pending_pairs: 0, warning: false },
    ],
    warnings: [],
    asset_summary: [{ asset_key: assetKey, index: 60, coverage: 90, visibility: 'banded', band: 'high' }],
    counts: {
      pairs: { compliant: 0, partially_effective: 0, non_compliant: 1, not_evaluable: 9, not_applicable: 0 },
      assets: { in_scope: 1, excluded_from_assessment: 0, unidentified: 0, authorization_pending: 0, unauthorized: 0 },
      deficiencies: { low: 0, medium: 0, high: 1, critical: 0 },
      network: { pending_services: 0, assets_with_pending_services: 0 },
    },
    context: { office_visibility: [], shared_cidr: [] },
  },
  pairs: [
    {
      asset_key: assetKey,
      asset_office_id: '',
      asset_type: 'server',
      control_key: 'A.8.2',
      criticality: 'critical',
      applicability: 'applicable',
      compliance: 0,
      status: 'non_compliant',
      reason_code: 'evaluable',
      evidence: { kind: 'answer_missing' },
      reasons: [
        {
          key: `${assetKey}|A.8.2|A.8.2.privileged_access:generic_or_default`,
          list: 'deficiency',
          class: 'deficiency',
          priority: 'high',
          reason_code: 'answer_generic_or_default',
          source: { kind: 'answer', question_key: 'A.8.2.privileged_access', option_key: 'generic_or_default' },
          adjustments: [],
        },
      ],
      priority: 'high',
    },
  ],
})

test('risk endpoint and REST: a hidden evaluation never exposes numbers, a partial select never hides them', async () => {
  const payload = await getPayload({ config })
  const a = await seedRiskOrganization(payload)
  const organizationId = String(a.organization.id)
  const assetKey = `asset:${a.server.id}`
  const hidden = handBuilt(assetKey, 'hidden')
  hidden.pairs[0].asset_office_id = String(a.office.id)
  await persistRiskEvaluation(payload, { organizationId, evaluatedAt: new Date(), ...hidden })
  const admin = await member(payload, organizationId, [String(a.office.id)], 'org_admin')

  const { status, body } = await call(payload, admin)
  assert.equal(status, 200)
  assert.equal(body.evaluation!.index, null)
  assert.equal(body.evaluation!.band, null)
  assert.equal(body.evaluation!.visibility, 'hidden')
  assert.deepEqual(body.evaluation!.top_assets, [])
  // Coverage and warnings stay visible; D_c follows the index.
  assert.equal(body.evaluation!.controls.length, 1)
  assert.equal(body.evaluation!.controls[0].deficiency, null)
  assert.equal(body.evaluation!.controls[0].coverage, 1)
  // The lists explain what is missing or wrong: never hidden with the index (contracts §10.5).
  assert.equal(body.totals.deficiencies, 1)
  assert.equal(body.list, 'deficiencies')
  assert.equal(body.items[0].control_key, 'A.8.2')

  const user = { id: admin, collection: 'users' } as never
  const rest = await payload.find({
    collection: 'risk-evaluations',
    overrideAccess: false,
    user,
    depth: 0,
    where: { organization: { equals: organizationId } },
  })
  assert.equal(rest.docs.length, 1)
  assert.equal(rest.docs[0].index, undefined)
  assert.equal(rest.docs[0].band, undefined)
  assert.equal(rest.docs[0].asset_summary, undefined)
  assert.equal(rest.docs[0].control_summary, undefined)
  assert.equal(rest.docs[0].coverage, 10)
  const contributions = await payload.find({
    collection: 'risk-contributions',
    overrideAccess: false,
    user,
    depth: 0,
    where: { organization: { equals: organizationId } },
  })
  assert.equal(contributions.docs.length, 1)
  assert.equal(contributions.docs[0].compliance, 0)

  // A partial select reaches field access without `visibility`: it must be looked up, not guessed.
  const banded = handBuilt(assetKey, 'banded')
  banded.pairs[0].asset_office_id = String(a.office.id)
  await persistRiskEvaluation(payload, { organizationId, evaluatedAt: new Date(), ...banded })
  const selected = await payload.find({
    collection: 'risk-evaluations',
    overrideAccess: false,
    user,
    depth: 0,
    sort: 'evaluated_at',
    select: { index: true, band: true },
    where: { organization: { equals: organizationId } },
  })
  assert.deepEqual(
    selected.docs.map(doc => [doc.index, doc.band]),
    [
      [undefined, undefined],
      [60, 'high'],
    ]
  )
})

test('risk endpoint: a Viewer must name one of its offices', async () => {
  const payload = await getPayload({ config })
  const a = await seedRiskOrganization(payload)
  const organizationId = String(a.organization.id)
  const officeId = String(a.office.id)
  await recalculateRisk(payload, { organizationId })
  const viewer = await member(payload, organizationId, [officeId], 'org_viewer')
  const { status, body } = await call(payload, viewer)
  assert.equal(status, 403)
  assert.deepEqual(body, { error: 'office_required' })
  const admin = await member(payload, organizationId, [officeId], 'org_admin')
  assert.equal((await call(payload, admin)).status, 200)
})

test('risk endpoint: a Manager without an office reads its assigned consolidation, not persisted', async () => {
  const payload = await getPayload({ config })
  const a = await seedRiskOrganization(payload)
  const organizationId = String(a.organization.id)
  const officeId = String(a.office.id)
  await recalculateRisk(payload, { organizationId })
  const evaluations = () =>
    payload.count({
      collection: 'risk-evaluations',
      overrideAccess: true,
      where: { organization: { equals: organizationId } },
    })
  const before = (await evaluations()).totalDocs
  const manager = await member(payload, organizationId, [officeId], 'office_manager')
  const { status, body } = await call(payload, manager)
  assert.equal(status, 200)
  assert.equal(body.scope, 'assigned_offices')
  assert.equal(body.evaluation?.id ?? null, null)
  assert.equal((await evaluations()).totalDocs, before)
})

test('risk endpoint: a Manager consolidation never shows the monitoring notice of an office outside its scope', async () => {
  const payload = await getPayload({ config })
  const a = await seedRiskOrganization(payload)
  const organizationId = String(a.organization.id)
  const officeId = String(a.office.id)
  const silent = await payload.create({
    collection: 'offices',
    overrideAccess: true,
    data: { organization: organizationId, name: 'Sin agente activo' },
  })
  // An office whose agent stopped reporting long ago, with one network asset.
  const agent = await payload.create({
    collection: 'agents',
    overrideAccess: true,
    context: { systemJob: true },
    data: {
      id: `agent-${Math.random().toString(36).slice(2)}`,
      office: silent.id,
      last_heartbeat_at: new Date(Date.now() - 86_400_000).toISOString(),
    },
  })
  await payload.create({
    collection: 'assets',
    overrideAccess: true,
    context: { systemJob: true },
    data: {
      asset_id: `silent-${Math.random().toString(36).slice(2)}`,
      agent: agent.id,
      office: silent.id,
      organization: organizationId,
      ip: '10.0.1.10',
      status: 'active',
      identified: true,
      confirmed_type: 'server',
      authorization_status: 'authorized',
      criticality: 'high',
      asset_coverage: { port_scan: 'complete', service_detection: 'complete' },
      services: [],
    } as never,
  })
  await recalculateRisk(payload, { organizationId })
  const silentNotice = (body: LatestRiskResponse) =>
    body.list === 'pending' &&
    body.items.some(item => item.control_key === 'A.8.16' && item.subject.kind === 'office' && item.subject.id === String(silent.id))

  const admin = await member(payload, organizationId, [officeId, String(silent.id)], 'org_admin')
  const organization = await call(payload, admin, '?list=pending&limit=50')
  assert.ok(silentNotice(organization.body), 'the organization sees the silent office once')
  assert.equal(
    organization.body.list === 'pending'
      ? organization.body.items.filter(item => item.control_key === 'A.8.16').length
      : 0,
    1
  )

  const manager = await member(payload, organizationId, [officeId], 'office_manager')
  const assigned = await call(payload, manager, '?list=pending&limit=50')
  assert.equal(assigned.body.scope, 'assigned_offices')
  assert.equal(silentNotice(assigned.body), false)
  assert.ok(!JSON.stringify(assigned.body).includes(String(silent.id)))
})
