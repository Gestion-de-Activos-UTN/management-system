import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPayload } from 'payload'
import type { CollectionSlug, Payload } from 'payload'
import config from '../../payload.config'
import { recalculateRisk } from '@/domain/risk/recalculateRisk'
import { manualResult, member, seedRiskOrganization } from '@/domain/risk/risk-integration-seed'

// REST row scoping per role (overrideAccess: false): office-scoped roles (office_manager,
// org_viewer) only reach their offices and never org-level rows; org_admin reaches everything.

async function seedTwoOffices(payload: Payload) {
  const { organization, office, server } = await seedRiskOrganization(payload)
  const other = await payload.create({
    collection: 'offices',
    overrideAccess: true,
    data: { organization: organization.id, name: 'Other' },
  })
  const admin = await member(
    payload,
    String(organization.id),
    [String(office.id), String(other.id)],
    'org_admin'
  )
  const laptop = {
    alias: 'Other office laptop',
    asset_category: 'computer',
    criticality: 'medium',
    owner: admin,
    office: other.id,
    organization: organization.id,
    status: 'active',
    review_interval: 'never',
  } as const
  const otherAsset = await payload.create({
    collection: 'non-network-assets',
    overrideAccess: true,
    data: laptop,
  })
  await payload.create({
    collection: 'non-network-assets',
    overrideAccess: true,
    data: { ...laptop, alias: 'Own office laptop', office: office.id },
  })
  const organizationId = String(organization.id)
  const ids = { organizationId, officeId: String(office.id), assetId: String(server.id) }
  const future = new Date(Date.now() + 86_400_000).toISOString()
  // Organization-level answer: office = null, asset = null.
  await payload.create({
    collection: 'compliance-results',
    overrideAccess: true,
    data: { ...manualResult(ids, 'A.5.25', 1, future), office: null, asset: null },
  })
  await payload.create({
    collection: 'compliance-results',
    overrideAccess: true,
    data: manualResult(ids, 'A.8.2', 1, future),
  })
  await recalculateRisk(payload, { organizationId })
  await recalculateRisk(payload, { organizationId, officeId: String(office.id) })
  await recalculateRisk(payload, { organizationId, officeId: String(other.id) })
  return { organizationId, office, other, server, otherAsset, admin }
}

const offices = async (payload: Payload, userId: string, collection: CollectionSlug) => {
  const result = await payload.find({
    collection,
    overrideAccess: false,
    user: { id: userId, collection: 'users' } as never,
    depth: 0,
    pagination: false,
  })
  return result.docs.map(doc => {
    const office = (doc as { office?: unknown }).office
    return collection === 'offices' ? String(doc.id) : office ? String(office) : null
  })
}

test('office scoping: office_manager and org_viewer only read rows of their offices', async () => {
  const payload = await getPayload({ config })
  const { organizationId, office, other, admin } = await seedTwoOffices(payload)
  const own = String(office.id)

  for (const slug of ['office_manager', 'org_viewer'] as const) {
    const scoped = await member(payload, organizationId, [own], slug)
    for (const collection of [
      'assets',
      'non-network-assets',
      'offices',
      'compliance-results',
      'risk-evaluations',
      'risk-contributions',
    ] as const) {
      const seen = await offices(payload, scoped, collection)
      assert.ok(seen.length > 0, `${slug} sees own ${collection}`)
      assert.ok(
        seen.every(id => id === own),
        `${slug} only sees its office in ${collection}: ${JSON.stringify(seen)}`
      )
    }
  }

  // org_admin keeps the organization-wide view, including org-level rows (office = null).
  assert.ok((await offices(payload, admin, 'risk-evaluations')).includes(null))
  assert.ok((await offices(payload, admin, 'compliance-results')).includes(null))
  assert.ok((await offices(payload, admin, 'non-network-assets')).includes(String(other.id)))
})

test('office scoping: REST update of another office asset is rejected', async () => {
  const payload = await getPayload({ config })
  const { organizationId, office, otherAsset } = await seedTwoOffices(payload)
  const manager = await member(payload, organizationId, [String(office.id)], 'office_manager')

  await assert.rejects(
    payload.update({
      collection: 'non-network-assets',
      id: otherAsset.id,
      overrideAccess: false,
      user: { id: manager, collection: 'users' } as never,
      data: { alias: 'Hijacked' },
    })
  )
  const unchanged = await payload.findByID({
    collection: 'non-network-assets',
    id: otherAsset.id,
    overrideAccess: true,
  })
  assert.equal(unchanged.alias, 'Other office laptop')
})
