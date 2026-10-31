import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { getPayload, handleEndpoints, type Payload, type SanitizedConfig } from 'payload'
import type { AssessmentInstance, NonNetworkAsset } from '@/app/types/payload-types'
import { seedRiskOrganization, member } from '@/domain/risk/risk-integration-seed'
import { RISK_QUESTIONS_V2 } from '@/domain/risk/catalog-v2'
import { ASSESSABLE_MANUAL } from '@/domain/risk/risk-asset-type'

let payload: Payload, config: SanitizedConfig, org: string, office: string, admin: string
let adminCookie: string, viewerCookie: string
const completed: Array<{ asset: string; cycle: string; command: ReturnType<typeof answers> }> = []
async function api(path: string, body?: unknown, cookie = adminCookie, method = 'POST') {
  const response = await handleEndpoints({
    config,
    request: new Request('http://localhost' + path, {
      method,
      headers: {
        origin: 'http://localhost:3001',
        ...(cookie ? { cookie } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  })
  return { status: response.status, body: await response.json(), response }
}
async function login(id: string) {
  const user = await payload.findByID({ collection: 'users', id, overrideAccess: true })
  const result = await api('/api/users/login', { email: user.email, password: 'x'.repeat(12) }, '')
  expect(result.status).toBe(200)
  return result.response.headers.get('set-cookie')!.split(';')[0]
}
function answers(cycle: AssessmentInstance) {
  return {
    answers: (cycle.question_set_snapshot as Array<{ key: string; version: number }>).map(item => {
      const definition = RISK_QUESTIONS_V2.find(question => question.key === item.key)!
      const option =
        definition.options.find(option => option.efficacy === 1) ?? definition.options[0]
      return {
        question_key: item.key,
        question_version: item.version,
        option_key: option.key,
        ...(option.requires_justification ? { justification: 'Justificación de prueba.' } : {}),
      }
    }),
  }
}
async function fixture(category: (typeof ASSESSABLE_MANUAL)[number]) {
  const details: Partial<NonNetworkAsset> =
    category === 'cloud_asset'
      ? { cloud_details: { kind: 'infrastructure', vendor: 'Proveedor de prueba' } }
      : category === 'software_license'
        ? {
            product_details: {
              software_vendor: 'Proveedor de prueba',
              software_product: 'Aplicación de prueba',
            },
          }
        : category === 'information_repository'
          ? { repository_details: { kind: 'database' } }
          : {}
  const asset = await payload.create({
    collection: 'non-network-assets',
    overrideAccess: true,
    data: {
      alias: `Revisión ${category}`,
      asset_category: category,
      organization: org,
      office,
      owner: admin,
      criticality: 'medium',
      review_interval: 'never',
      ...details,
    },
  })
  const cycles = await payload.find({
    collection: 'assessment-instances',
    overrideAccess: true,
    depth: 0,
    where: {
      and: [{ manual_asset: { equals: asset.id } }, { status: { in: ['pending', 'in_progress'] } }],
    },
  })
  expect(cycles.totalDocs).toBe(1)
  const cycle = cycles.docs[0]
  const command = answers(cycle)
  expect(command.answers.length).toBeGreaterThan(0)
  return { asset: String(asset.id), cycle: String(cycle.id), command }
}
const results = (id: string) =>
  payload.count({
    collection: 'compliance-results',
    overrideAccess: true,
    where: { manual_asset: { equals: id } },
  })
beforeAll(async () => {
  if (
    process.env.DATABASE_URL !== 'postgresql://siam_test@127.0.0.1:55447/siam_manual_reviews_checks'
  )
    throw new Error('Use the isolated manual reviews database')
  config = await (await import('../payload.config')).default
  config.typescript.autoGenerate = false
  config.admin.importMap.autoGenerate = false
  config.jobs.autoRun = []
  payload = await getPayload({ config })
  const seed = await seedRiskOrganization(payload)
  org = String(seed.organization.id)
  office = String(seed.office.id)
  admin = await member(payload, org, [office], 'org_admin')
  const viewer = await member(payload, org, [office], 'org_viewer')
  adminCookie = await login(admin)
  viewerCookie = await login(viewer)
}, 60000)
afterAll(async () => {
  if (payload) await payload.destroy()
})
it.each(ASSESSABLE_MANUAL)(
  'completes a real %s review and persists its answers/results',
  async category => {
    const row = await fixture(category)
    const response = await api(`/api/v1/assessments/${row.cycle}/complete`, row.command)
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(
      (
        await payload.findByID({
          collection: 'assessment-instances',
          id: row.cycle,
          overrideAccess: true,
        })
      ).status
    ).toBe('completed')
    const keys = new Set(
      row.command.answers.map(
        answer =>
          RISK_QUESTIONS_V2.find(question => question.key === answer.question_key)!.control_key
      )
    )
    expect((await results(row.asset)).totalDocs).toBe(keys.size)
    const saved = await payload.count({
      collection: 'assessment-answers',
      overrideAccess: true,
      where: { assessment: { equals: row.cycle } },
    })
    expect(saved.totalDocs).toBe(row.command.answers.length)
    completed.push(row)
  }
)
it('does not duplicate results if completing the cloud review is retried', async () => {
  const row =
    completed.find(row =>
      row.command.answers.some(answer => answer.question_key.includes('cloud'))
    ) ?? completed[2]
  const count = (await results(row.asset)).totalDocs
  expect((await api(`/api/v1/assessments/${row.cycle}/complete`, row.command)).status).toBe(200)
  expect((await results(row.asset)).totalDocs).toBe(count)
})
it('keeps an unowned cloud review forbidden for Viewer', async () => {
  const row = await fixture('cloud_asset')
  expect(
    (await api(`/api/v1/assessments/${row.cycle}/complete`, row.command, viewerCookie)).status
  ).toBe(403)
  expect((await results(row.asset)).totalDocs).toBe(0)
})
it('rolls back a failed completion while preserving the previously saved cloud draft', async () => {
  const row = await fixture('cloud_asset')
  const draft = { answers: row.command.answers.slice(0, 1) }
  expect(
    (await api(`/api/v1/assessments/${row.cycle}/draft`, draft, adminCookie, 'PATCH')).status
  ).toBe(200)
  const original = payload.create.bind(payload)
  const spy = vi.spyOn(payload, 'create').mockImplementation(async options => {
    if (options.collection === 'compliance-results')
      throw new Error('Synthetic result write failure')
    return original(options)
  })
  try {
    expect((await api(`/api/v1/assessments/${row.cycle}/complete`, row.command)).status).toBe(400)
  } finally {
    spy.mockRestore()
  }
  expect((await results(row.asset)).totalDocs).toBe(0)
  expect(
    (
      await payload.findByID({
        collection: 'assessment-instances',
        id: row.cycle,
        overrideAccess: true,
      })
    ).status
  ).toBe('in_progress')
  const kept = await payload.count({
    collection: 'assessment-answers',
    overrideAccess: true,
    where: { assessment: { equals: row.cycle } },
  })
  expect(kept.totalDocs).toBe(1)
})
