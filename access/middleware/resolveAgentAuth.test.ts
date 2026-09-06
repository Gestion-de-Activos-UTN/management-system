import { test } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import { resolveAgentAuth, AgentAuthError, type AgentAuthDeps } from './resolveAgentAuth'
import { AGENT_LOCKOUT_THRESHOLD, AGENT_LOCKOUT_ESCALATION_THRESHOLD } from '../../domain/agents/agent-state'

const TOKEN = 'a'.repeat(64)
const PREFIX = TOKEN.slice(0, 8)

async function makeAgent(
  overrides: Partial<{
    is_active: boolean
    failedAttempts: number
    lockedUntil: string | null
    lockoutCount: number
  }> = {}
) {
  return {
    id: 'agent-001',
    office: 'office-1',
    organization: 'org-1',
    apiKeyHash: await bcrypt.hash(TOKEN, 4),
    is_active: true,
    failedAttempts: 0,
    lockedUntil: null,
    lockoutCount: 0,
    ...overrides,
  }
}

function noopDeps(findAgentByPrefix: AgentAuthDeps['findAgentByPrefix']): AgentAuthDeps {
  return {
    findAgentByPrefix,
    recordFailedAttempt: async () => {},
    resetAttempts: async () => {},
  }
}

test('resuelve agente con token válido', async () => {
  const agent = await makeAgent()
  const result = await resolveAgentAuth(
    { authorization: `Bearer ${TOKEN}`, 'x-agent-id': 'agent-001' },
    noopDeps(async p => (p === PREFIX ? agent : null))
  )
  assert.deepEqual(result, { agentId: 'agent-001', officeId: 'office-1', organizationId: 'org-1' })
})

test('rechaza si el prefix no existe', async () => {
  await assert.rejects(
    resolveAgentAuth(
      { authorization: `Bearer ${TOKEN}` },
      noopDeps(async () => null)
    ),
    AgentAuthError
  )
})

test('rechaza si el hash no matchea', async () => {
  const agent = await makeAgent()
  await assert.rejects(
    resolveAgentAuth(
      { authorization: 'Bearer ' + 'b'.repeat(64) },
      noopDeps(async () => agent)
    ),
    AgentAuthError
  )
})

test('hash inválido incrementa failedAttempts sobre ese agente', async () => {
  const agent = await makeAgent({ failedAttempts: 2 })
  const recorded: Array<{ id: string; failedAttempts: number }> = []
  const deps: AgentAuthDeps = {
    findAgentByPrefix: async () => agent,
    recordFailedAttempt: async a => {
      recorded.push(a)
    },
    resetAttempts: async () => {},
  }
  await assert.rejects(
    resolveAgentAuth({ authorization: 'Bearer ' + 'b'.repeat(64) }, deps),
    AgentAuthError
  )
  assert.equal(recorded[0]?.id, 'agent-001')
  assert.equal(recorded[0]?.failedAttempts, 2)
})

test('rechaza con 429 mientras el agente está en lockout, sin comparar el hash', async () => {
  const future = new Date(Date.now() + 60_000).toISOString()
  const agent = await makeAgent({ lockedUntil: future })
  let compareCalled = false
  const deps: AgentAuthDeps = {
    findAgentByPrefix: async () => agent,
    recordFailedAttempt: async () => {
      compareCalled = true
    },
    resetAttempts: async () => {},
  }
  let caught: unknown = null
  try {
    await resolveAgentAuth({ authorization: `Bearer ${TOKEN}` }, deps)
  } catch (err) {
    caught = err
  }
  assert.ok(caught instanceof AgentAuthError)
  assert.equal((caught as InstanceType<typeof AgentAuthError>).status, 429)
  assert.equal(compareCalled, false)
})

test('recordFailedAttempt: por debajo del umbral solo incrementa el contador', async () => {
  const authDeps = await import('./resolveAgentAuth')
  const { createPayloadAgentAuthDeps } = authDeps
  const updates: Array<Record<string, unknown>> = []
  const fakePayload = {
    update: async ({ data }: { data: Record<string, unknown> }) => {
      updates.push(data)
      return {}
    },
  } as unknown as Parameters<typeof createPayloadAgentAuthDeps>[0]
  const deps = createPayloadAgentAuthDeps(fakePayload)
  const agent = await makeAgent({ failedAttempts: AGENT_LOCKOUT_THRESHOLD - 2, lockoutCount: 0 })
  await deps.recordFailedAttempt(agent)
  assert.equal(updates.length, 1)
  assert.equal(updates[0].failedAttempts, AGENT_LOCKOUT_THRESHOLD - 1)
  assert.equal('lockedUntil' in updates[0], false)
})

test('recordFailedAttempt: al llegar al umbral bloquea temporalmente, no revoca', async () => {
  const { createPayloadAgentAuthDeps } = await import('./resolveAgentAuth')
  const updates: Array<Record<string, unknown>> = []
  const fakePayload = {
    update: async ({ data }: { data: Record<string, unknown> }) => {
      updates.push(data)
      return {}
    },
  } as unknown as Parameters<typeof createPayloadAgentAuthDeps>[0]
  const deps = createPayloadAgentAuthDeps(fakePayload)
  const agent = await makeAgent({ failedAttempts: AGENT_LOCKOUT_THRESHOLD - 1, lockoutCount: 0 })
  await deps.recordFailedAttempt(agent)
  assert.equal(updates.length, 1)
  assert.equal(updates[0].lockoutCount, 1)
  assert.ok(updates[0].lockedUntil)
  assert.equal(updates[0].lifecycle_status, undefined)
})

test('recordFailedAttempt: tras ESCALATION_THRESHOLD ciclos de lockout, revoca automáticamente', async () => {
  const { createPayloadAgentAuthDeps } = await import('./resolveAgentAuth')
  const updates: Array<Record<string, unknown>> = []
  const fakePayload = {
    update: async ({ data }: { data: Record<string, unknown> }) => {
      updates.push(data)
      return {}
    },
  } as unknown as Parameters<typeof createPayloadAgentAuthDeps>[0]
  const deps = createPayloadAgentAuthDeps(fakePayload)
  const agent = await makeAgent({
    failedAttempts: AGENT_LOCKOUT_THRESHOLD - 1,
    lockoutCount: AGENT_LOCKOUT_ESCALATION_THRESHOLD - 1,
  })
  await deps.recordFailedAttempt(agent)
  assert.equal(updates.length, 1)
  assert.equal(updates[0].lifecycle_status, 'revoked')
  assert.equal(updates[0].is_active, false)
  assert.equal(updates[0].revocation_reason, 'auto_lockout_abuse')
})

test('rechaza agente revocado', async () => {
  const agent = await makeAgent({ is_active: false })
  await assert.rejects(
    resolveAgentAuth(
      { authorization: `Bearer ${TOKEN}` },
      noopDeps(async () => agent)
    ),
    AgentAuthError
  )
})

test('rechaza mismatch de X-Agent-ID', async () => {
  const agent = await makeAgent()
  await assert.rejects(
    resolveAgentAuth(
      { authorization: `Bearer ${TOKEN}`, 'x-agent-id': 'agent-999' },
      noopDeps(async () => agent)
    ),
    AgentAuthError
  )
})

test('X-Agent-ID ausente no rechaza (heartbeat/vendor no lo mandan)', async () => {
  const agent = await makeAgent()
  const result = await resolveAgentAuth(
    { authorization: `Bearer ${TOKEN}` },
    noopDeps(async () => agent)
  )
  assert.equal(result.agentId, 'agent-001')
})
