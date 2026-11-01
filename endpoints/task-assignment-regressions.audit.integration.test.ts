import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { taskActivity } from '@/modules/tasks/task-activity'
import { getPayload, handleEndpoints, type Payload, type SanitizedConfig } from 'payload'
import { seedRiskOrganization, member } from '@/domain/risk/risk-integration-seed'

let payload: Payload, config: SanitizedConfig, org: string, office: string, second: string
let admin: string,
  viewer: string,
  adminCookie: string,
  viewerCookie: string,
  secondViewerCookie: string
let manager: string, managerCookie: string

async function api(
  path: string,
  body?: unknown,
  cookie = adminCookie,
  method = body ? 'POST' : 'GET'
) {
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

beforeAll(async () => {
  if (
    !/^postgresql:\/\/siam_test@127\.0\.0\.1:55448\/siam_task_checks(?:_[a-z0-9]+)?$/.test(
      process.env.DATABASE_URL ?? ''
    )
  )
    throw new Error('Use the isolated task checks database')
  config = await (await import('../payload.config')).default
  config.typescript.autoGenerate = false
  config.admin.importMap.autoGenerate = false
  config.jobs.autoRun = []
  payload = await getPayload({ config })
  const seed = await seedRiskOrganization(payload)
  org = String(seed.organization.id)
  office = String(seed.office.id)
  second = String(
    (
      await payload.create({
        collection: 'offices',
        overrideAccess: true,
        data: { organization: org, name: 'Segunda oficina' },
      })
    ).id
  )
  admin = await member(payload, org, [office, second], 'org_admin')
  viewer = await member(payload, org, [office], 'org_viewer')
  const secondViewer = await member(payload, org, [second], 'org_viewer')
  adminCookie = await login(admin)
  viewerCookie = await login(viewer)
  secondViewerCookie = await login(secondViewer)
  manager = await member(payload, org, [office], 'office_manager')
  managerCookie = await login(manager)
}, 60000)

afterAll(async () => {
  if (payload) await payload.destroy()
})

it('reports administrative completion to a stale manager without changing the completed task', async () => {
  const created = await api('/api/v1/tasks', {
    title: 'Finalización administrativa con vista desactualizada',
    priority: 'normal',
    global: false,
    office_ids: [office],
    assignment_kind: 'user',
    assigned_user: manager,
  })
  expect(created.status).toBe(201)
  const id = String(created.body.docs[0].id)
  expect((await api(`/api/v1/tasks/${id}/claim`, {}, managerCookie)).status).toBe(200)
  expect(
    (await api(`/api/v1/tasks/${id}/force-complete`, { reason: 'Resuelta por administración.' }))
      .status
  ).toBe(200)
  const previous = await payload.findByID({
    collection: 'tasks',
    id,
    overrideAccess: true,
    depth: 0,
  })
  for (const action of ['complete', 'release']) {
    const result = await api(`/api/v1/tasks/${id}/${action}`, {}, managerCookie)
    expect(result.status).toBe(409)
    expect(result.body.error).toBe('task_completed_by_admin')
  }
  const repeated = await api(`/api/v1/tasks/${id}/force-complete`, { reason: 'Segundo intento.' })
  expect(repeated.status).toBe(409)
  expect(repeated.body.error).toBe('task_completed_by_admin')
  const saved = await payload.findByID({ collection: 'tasks', id, overrideAccess: true, depth: 0 })
  expect(saved.status).toBe('completed')
  expect(saved.completed_by).toEqual(previous.completed_by)
  expect(saved.completed_at).toEqual(previous.completed_at)
  expect(saved.completion_reason).toBe('Resuelta por administración.')
  expect(saved.claimed_by).toEqual(previous.claimed_by)
  const detail = await api(`/api/v1/tasks/${id}`, undefined, managerCookie)
  expect(detail.status).toBe(200)
  expect(detail.body.available_actions).not.toContain('complete')
  expect(detail.body.available_actions).not.toContain('release')
  const outsideOffice = await api(`/api/v1/tasks/${id}/complete`, {}, secondViewerCookie)
  expect(outsideOffice.status).toBe(404)
  expect(outsideOffice.body.error).toBe('task_not_found')
})

it('distinguishes completion conflicts from another person owning an active claim', async () => {
  const created = await api('/api/v1/tasks', {
    title: 'Conflicto de estado o reclamo ajeno',
    priority: 'normal',
    global: false,
    office_ids: [office],
    assignment_kind: 'open_pool',
  })
  expect(created.status).toBe(201)
  const id = String(created.body.docs[0].id)
  const pending = await api(`/api/v1/tasks/${id}/complete`, {}, managerCookie)
  expect(pending.status).toBe(409)
  expect(pending.body.error).toBe('task_state_changed')
  expect((await api(`/api/v1/tasks/${id}/claim`, {}, managerCookie)).status).toBe(200)
  const otherClaimant = await api(`/api/v1/tasks/${id}/complete`, {}, viewerCookie)
  expect(otherClaimant.status).toBe(403)
  expect(otherClaimant.body.error).toBe('not_claimant')
  expect((await api(`/api/v1/tasks/${id}/complete`, {}, managerCookie)).status).toBe(200)
  const repeated = await api(`/api/v1/tasks/${id}/complete`, {}, managerCookie)
  expect(repeated.status).toBe(409)
  expect(repeated.body.error).toBe('task_already_completed')
})

it('reports cancellation instead of blaming the previous claimant', async () => {
  const created = await api('/api/v1/tasks', {
    title: 'Cancelación con vista desactualizada',
    priority: 'normal',
    global: false,
    office_ids: [office],
    assignment_kind: 'user',
    assigned_user: manager,
  })
  expect(created.status).toBe(201)
  const id = String(created.body.docs[0].id)
  expect((await api(`/api/v1/tasks/${id}/claim`, {}, managerCookie)).status).toBe(200)
  expect((await api(`/api/v1/tasks/${id}/cancel`, { reason: 'Ya no es necesaria.' })).status).toBe(
    200
  )
  for (const action of ['complete', 'release']) {
    const result = await api(`/api/v1/tasks/${id}/${action}`, {}, managerCookie)
    expect(result.status).toBe(409)
    expect(result.body.error).toBe('task_cancelled')
  }
  const saved = await payload.findByID({ collection: 'tasks', id, overrideAccess: true, depth: 0 })
  expect(saved.status).toBe('cancelled')
  expect(saved.completed_at).toBeNull()
})

it('offers roles and users for a single office through an authenticated request', async () => {
  const result = await api(`/api/v1/tasks/assignment-options?office_ids=${office}`)
  expect(result.status).toBe(200)
  expect(result.body.roles.map((role: { slug: string }) => role.slug)).toEqual(
    expect.arrayContaining(['org_admin', 'org_viewer'])
  )
  expect(result.body.users.map((user: { id: string }) => user.id)).toContain(viewer)
})

it('keeps common roles across multiple offices and excludes users without full coverage', async () => {
  const result = await api(`/api/v1/tasks/assignment-options?office_ids=${office},${second}`)
  expect(result.status).toBe(200)
  expect(result.body.roles.map((role: { slug: string }) => role.slug)).toContain('org_admin')
  // The same role may be covered by different people in the two offices.
  expect(result.body.roles.map((role: { slug: string }) => role.slug)).toContain('org_viewer')
  expect(result.body.users.map((user: { id: string }) => user.id)).not.toContain(viewer)
})

it('shows a newly assigned task in the viewer mine list and permits opening it', async () => {
  const result = await api('/api/v1/tasks', {
    title: 'Tarea directa para Viewer',
    priority: 'normal',
    global: false,
    office_ids: [office],
    assignment_kind: 'user',
    assigned_user: viewer,
  })
  expect(result.status).toBe(201)
  const id = String(result.body.docs[0].id)
  const list = await api(
    '/api/v1/tasks?view=mine&status=pending,in_progress,planned',
    undefined,
    viewerCookie
  )
  expect(list.status, JSON.stringify(list.body)).toBe(200)
  expect(list.body.docs.map((task: { id: string }) => task.id)).toContain(id)
  const detail = await api(`/api/v1/tasks/${id}`, undefined, viewerCookie)
  expect(detail.status, JSON.stringify(detail.body)).toBe(200)
  expect(detail.body.available_actions).toContain('claim')
  expect(detail.body.assignment_info).toMatchObject({
    office_name: 'Main',
    user_name: 'Risk org_viewer',
    role_name: null,
  })
})

it('shows an organization-wide direct assignment while filtering an assigned office', async () => {
  const created = await api('/api/v1/tasks', {
    title: 'Tarea global directa para Viewer',
    priority: 'normal',
    global: true,
    office_ids: [],
    assignment_kind: 'user',
    assigned_user: viewer,
  })
  expect(created.status).toBe(201)
  const result = await api(`/api/v1/tasks?view=mine&office_id=${office}`, undefined, viewerCookie)
  expect(result.status).toBe(200)
  expect(result.body.docs.map((task: { id: string }) => task.id)).toContain(created.body.docs[0].id)
})

it('offers an organization-wide open pool in every authorized office filter', async () => {
  const created = await api('/api/v1/tasks', {
    title: 'Pool de toda la organización',
    priority: 'normal',
    global: true,
    office_ids: [],
    assignment_kind: 'open_pool',
  })
  expect(created.status).toBe(201)
  const id = created.body.docs[0].id
  for (const [cookie, selected] of [
    [viewerCookie, office],
    [secondViewerCookie, second],
  ]) {
    for (const suffix of ['', `&office_id=${selected}`]) {
      const result = await api(`/api/v1/tasks?view=pool${suffix}`, undefined, cookie)
      expect(result.status).toBe(200)
      expect(result.body.docs.map((task: { id: string }) => task.id)).toContain(id)
    }
  }
})

it('excludes a Viewer from assignment options for an office outside their membership', async () => {
  const result = await api(`/api/v1/tasks/assignment-options?office_ids=${second}`)
  expect(result.status).toBe(200)
  expect(result.body.users.map((user: { id: string }) => user.id)).not.toContain(viewer)
})

it('rejects creation for a Viewer outside the office without creating a task', async () => {
  const before = await payload.count({ collection: 'tasks', overrideAccess: true })
  const created = await api('/api/v1/tasks', {
    title: 'Asignación fuera de oficina',
    priority: 'normal',
    global: false,
    office_ids: [second],
    assignment_kind: 'user',
    assigned_user: viewer,
  })
  expect(created.status).toBe(400)
  expect(created.body.error).toBe('no_eligible_assignees')
  expect((await payload.count({ collection: 'tasks', overrideAccess: true })).totalDocs).toBe(
    before.totalDocs
  )
})

it('rejects reassignment to a Viewer without office coverage and preserves assignment', async () => {
  const created = await api('/api/v1/tasks', {
    title: 'Reasignación fuera de oficina',
    priority: 'normal',
    global: false,
    office_ids: [second],
    assignment_kind: 'open_pool',
  })
  expect(created.status).toBe(201)
  const id = String(created.body.docs[0].id)
  const options = await api(`/api/v1/tasks/assignment-options?task_id=${id}`)
  expect(options.body.users.map((user: { id: string }) => user.id)).not.toContain(viewer)
  const changed = await api(`/api/v1/tasks/${id}/reassign`, {
    assignment_kind: 'user',
    assigned_user: viewer,
  })
  expect(changed.status).toBe(400)
  const saved = await payload.findByID({ collection: 'tasks', id, overrideAccess: true, depth: 0 })
  expect(saved.assignment_kind).toBe('open_pool')
  expect(saved.assigned_user).toBeNull()
})

it('still hides other-office tasks and forbids selecting an unauthorized office', async () => {
  const created = await api('/api/v1/tasks', {
    title: 'Pool exclusivo de otra oficina',
    priority: 'normal',
    global: false,
    office_ids: [second],
    assignment_kind: 'open_pool',
  })
  expect(created.status).toBe(201)
  const list = await api(`/api/v1/tasks?view=pool&office_id=${office}`, undefined, viewerCookie)
  expect(list.body.docs.map((task: { id: string }) => task.id)).not.toContain(
    created.body.docs[0].id
  )
  expect(
    (await api(`/api/v1/tasks/${created.body.docs[0].id}`, undefined, viewerCookie)).status
  ).toBe(404)
  expect(
    (await api(`/api/v1/tasks?view=pool&office_id=${second}`, undefined, viewerCookie)).status
  ).toBe(403)
})

it('shows a role label and office in details without exposing raw member documents', async () => {
  const options = await api(`/api/v1/tasks/assignment-options?office_ids=${office}`)
  const role = options.body.roles.find((role: { slug: string }) => role.slug === 'org_viewer')
  const created = await api('/api/v1/tasks', {
    title: 'Detalle de tarea por rol',
    priority: 'normal',
    global: false,
    office_ids: [office],
    assignment_kind: 'role',
    assigned_role: role.id,
  })
  expect(created.status).toBe(201)
  const detail = await api(`/api/v1/tasks/${created.body.docs[0].id}`, undefined, viewerCookie)
  expect(detail.status).toBe(200)
  expect(detail.body.assignment_info).toEqual({
    office_name: 'Main',
    role_name: 'Observador de la organización',
    user_name: null,
  })
})

it('does not include global tasks belonging to another organization', async () => {
  const other = await seedRiskOrganization(payload)
  const otherAdmin = await member(
    payload,
    String(other.organization.id),
    [String(other.office.id)],
    'org_admin'
  )
  const otherTask = await payload.create({
    collection: 'tasks',
    overrideAccess: true,
    data: {
      title: 'Pool global de organización ajena',
      status: 'pending',
      organization: other.organization.id,
      assignment_kind: 'open_pool',
      priority: 'normal',
      start_at: new Date().toISOString(),
      created_by: { relationTo: 'users', value: otherAdmin },
    },
  })
  const result = await api(`/api/v1/tasks?view=pool&office_id=${office}`, undefined, viewerCookie)
  expect(result.status).toBe(200)
  expect(result.body.docs.map((task: { id: string }) => task.id)).not.toContain(otherTask.id)
})

it('records pending reassignment without inventing a release', async () => {
  const created = await api('/api/v1/tasks', {
    title: 'Historial de reasignación pendiente',
    priority: 'normal',
    global: false,
    office_ids: [office],
    assignment_kind: 'open_pool',
  })
  expect(created.status).toBe(201)
  const id = String(created.body.docs[0].id)
  expect(
    (await api(`/api/v1/tasks/${id}/reassign`, { assignment_kind: 'user', assigned_user: viewer }))
      .status
  ).toBe(200)
  const detail = await api(`/api/v1/tasks/${id}`)
  expect(detail.body.actor_labels.claim_events).toEqual([
    { action: 'reassigned', at: expect.any(String), actor: 'Risk org_admin' },
  ])
})

it('persists release and reassignment atomically before a second claim', async () => {
  const created = await api('/api/v1/tasks', {
    title: 'Historial de reasignación en progreso',
    priority: 'normal',
    global: false,
    office_ids: [office],
    assignment_kind: 'user',
    assigned_user: viewer,
  })
  expect(created.status).toBe(201)
  const id = String(created.body.docs[0].id)
  expect((await api(`/api/v1/tasks/${id}/claim`, {}, viewerCookie)).status).toBe(200)
  expect(
    (await api(`/api/v1/tasks/${id}/reassign`, { assignment_kind: 'user', assigned_user: admin }))
      .status
  ).toBe(200)
  const reassigned = await payload.findByID({
    collection: 'tasks',
    id,
    overrideAccess: true,
    depth: 0,
  })
  expect(reassigned.status).toBe('pending')
  expect(reassigned.claimed_by ?? null).toBeNull()
  expect(reassigned.claimed_at).toBeNull()
  expect(reassigned.claim_history).toMatchObject([
    { action: 'claimed' },
    { action: 'released', reason: 'task_reassigned', by: { relationTo: 'users', value: admin } },
    { action: 'reassigned', by: { relationTo: 'users', value: admin } },
  ])
  expect((await api(`/api/v1/tasks/${id}/claim`, {})).status).toBe(200)
  const detail = await api(`/api/v1/tasks/${id}`)
  expect(
    detail.body.actor_labels.claim_events.map((event: { action: string }) => event.action)
  ).toEqual(['claimed', 'released', 'reassigned', 'claimed'])
  expect(taskActivity(detail.body).map(event => event.label)).toEqual([
    'Reclamada',
    'Reasignada',
    'Reclamada',
    'Creada',
  ])
})

it('keeps the previous claimant and history if reassignment persistence fails', async () => {
  const created = await api('/api/v1/tasks', {
    title: 'Rollback de reasignación',
    priority: 'normal',
    global: false,
    office_ids: [office],
    assignment_kind: 'user',
    assigned_user: viewer,
  })
  expect(created.status).toBe(201)
  const id = String(created.body.docs[0].id)
  expect((await api(`/api/v1/tasks/${id}/claim`, {}, viewerCookie)).status).toBe(200)
  const previous = await payload.findByID({
    collection: 'tasks',
    id,
    overrideAccess: true,
    depth: 0,
  })
  const update = payload.update.bind(payload)
  const spy = vi.spyOn(payload, 'update').mockImplementation((async (options: any) => {
    if (options.collection === 'tasks' && options.id === id)
      throw new Error('Injected reassignment failure')
    return update(options)
  }) as typeof payload.update)
  try {
    expect(
      (await api(`/api/v1/tasks/${id}/reassign`, { assignment_kind: 'open_pool' })).status
    ).toBe(500)
  } finally {
    spy.mockRestore()
  }
  const saved = await payload.findByID({ collection: 'tasks', id, overrideAccess: true, depth: 0 })
  expect(saved.status).toBe('in_progress')
  expect(saved.claimed_by).toEqual(previous.claimed_by)
  expect(saved.claim_history).toEqual(previous.claim_history)
  expect(saved.assignment_kind).toBe('user')
})
