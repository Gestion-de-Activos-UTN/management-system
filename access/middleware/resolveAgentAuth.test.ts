import { test } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import { resolveAgentAuth, AgentAuthError } from './resolveAgentAuth'

const TOKEN = 'a'.repeat(64)
const PREFIX = TOKEN.slice(0, 8)

async function makeAgent(overrides: Partial<{ is_active: boolean }> = {}) {
  return {
    id: 'agent-001',
    office: 'office-1',
    organization: 'org-1',
    apiKeyHash: await bcrypt.hash(TOKEN, 4),
    is_active: true,
    ...overrides,
  }
}

test('resuelve agente con token válido', async () => {
  const agent = await makeAgent()
  const result = await resolveAgentAuth(
    { authorization: `Bearer ${TOKEN}`, 'x-agent-id': 'agent-001' },
    { findAgentByPrefix: async (p) => (p === PREFIX ? agent : null) },
  )
  assert.deepEqual(result, { agentId: 'agent-001', officeId: 'office-1', organizationId: 'org-1' })
})

test('rechaza si el prefix no existe', async () => {
  await assert.rejects(
    resolveAgentAuth(
      { authorization: `Bearer ${TOKEN}` },
      { findAgentByPrefix: async () => null },
    ),
    AgentAuthError,
  )
})

test('rechaza si el hash no matchea', async () => {
  const agent = await makeAgent()
  await assert.rejects(
    resolveAgentAuth(
      { authorization: 'Bearer ' + 'b'.repeat(64) },
      { findAgentByPrefix: async () => agent },
    ),
    AgentAuthError,
  )
})

test('rechaza agente revocado', async () => {
  const agent = await makeAgent({ is_active: false })
  await assert.rejects(
    resolveAgentAuth(
      { authorization: `Bearer ${TOKEN}` },
      { findAgentByPrefix: async () => agent },
    ),
    AgentAuthError,
  )
})

test('rechaza mismatch de X-Agent-ID', async () => {
  const agent = await makeAgent()
  await assert.rejects(
    resolveAgentAuth(
      { authorization: `Bearer ${TOKEN}`, 'x-agent-id': 'agent-999' },
      { findAgentByPrefix: async () => agent },
    ),
    AgentAuthError,
  )
})

test('X-Agent-ID ausente no rechaza (heartbeat/vendor no lo mandan)', async () => {
  const agent = await makeAgent()
  const result = await resolveAgentAuth(
    { authorization: `Bearer ${TOKEN}` },
    { findAgentByPrefix: async () => agent },
  )
  assert.equal(result.agentId, 'agent-001')
})
