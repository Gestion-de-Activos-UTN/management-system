import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPayload } from 'payload'
import type { Payload, PayloadRequest } from 'payload'
import config from '../payload.config'
import { persistRiskEvaluation } from '@/domain/risk/persistRiskEvaluation'
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

  const own = await call(payload, admin)
  assert.equal(own.status, 200)
  assert.ok(own.body.evaluation)
  assert.ok(own.body.contributions.length > 0)
  assert.ok(own.body.contributions.every(row => row.asset_key === `asset:${a.server.id}`))
  // Labels are resolved only inside the caller's organization.
  assert.ok(own.body.contributions.every(row => row.asset_label === '10.0.0.10'))
  assert.deepEqual(
    own.body.evaluation!.top_assets.map(item => item.asset_id),
    [`asset:${a.server.id}`]
  )

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
})

test('risk endpoint and REST: a hidden evaluation never exposes numbers', async () => {
  const payload = await getPayload({ config })
  const a = await seedRiskOrganization(payload)
  const organizationId = String(a.organization.id)
  const assetKey = `asset:${a.server.id}`
  // Hand-built result: a raw score exists, but coverage is below the visibility threshold.
  await persistRiskEvaluation(payload, {
    organizationId,
    policy: 'essential',
    evaluatedAt: new Date(),
    undeterminedExposure: [],
    result: {
      contributions: [
        {
          asset_id: assetKey,
          control_key: 'A.8.2',
          criticality: 'critical',
          severity: 'critical',
          exposure: 'high',
          exposure_source: 'scan',
          scope_multiplier: 1,
          efficacy: 0,
          reason_code: 'fixture',
          unit_kind: 'asset',
          unit_id: assetKey,
          status: 'non_compliant',
          coverage_weight: 1,
          inherent_risk: 64,
          residual_risk: 64,
        },
      ],
      controls: [
        {
          control_key: 'A.8.2',
          residual_raw: 64,
          residual_capped: 64,
          capped: false,
          systemic_failure: false,
        },
      ],
      assets: [
        { asset_id: assetKey, score: 60, band: 'high', inherent_risk: 64, residual_risk: 64 },
      ],
      riem: 1,
      rro_raw: 1,
      rro_adjusted: 1,
      score: 60,
      base_band: 'high',
      final_band: 'high',
      coverage: 10,
      confidence: 'hidden',
      effective_confidence: 'hidden',
      unknown_percentage: 0,
      severe_concentration_percentage: 0,
      severe_concentration: false,
      critical_asset_alerts: [],
      counts: {
        compliant: 0,
        partially_effective: 0,
        non_compliant: 1,
        not_evaluable: 9,
        excluded: 0,
        excluded_assets: 0,
        unconfirmed_assets: 0,
      },
    },
  })
  const admin = await member(payload, organizationId, [String(a.office.id)], 'org_admin')

  const { status, body } = await call(payload, admin)
  assert.equal(status, 200)
  assert.equal(body.evaluation!.score, null)
  assert.equal(body.evaluation!.final_band, null)
  assert.deepEqual(body.evaluation!.top_assets, [])
  assert.deepEqual(body.evaluation!.controls, [])
  assert.ok(body.contributions.every(row => row.residual_risk === null))

  const user = { id: admin, collection: 'users' } as never
  const rest = await payload.find({
    collection: 'risk-evaluations',
    overrideAccess: false,
    user,
    depth: 0,
    where: { organization: { equals: organizationId } },
  })
  assert.equal(rest.docs.length, 1)
  assert.equal(rest.docs[0].score, undefined)
  assert.equal(rest.docs[0].asset_summary, undefined)
  const contributions = await payload.find({
    collection: 'risk-contributions',
    overrideAccess: false,
    user,
    depth: 0,
    where: { organization: { equals: organizationId } },
  })
  assert.equal(contributions.docs.length, 1)
  assert.equal(contributions.docs[0].residual_risk, undefined)
})
