import bcrypt from 'bcryptjs'
import type { Payload } from 'payload'

export class AgentAuthError extends Error {}

export interface AgentAuthResult {
  agentId: string
  officeId: string
  organizationId: string
}

interface AgentAuthRecord {
  id: string
  // Offices/Organizations usan el id UUID default de Payload (no los overrideamos como Agents/ScanReports).
  office: string
  organization: string
  apiKeyHash: string
  is_active: boolean
  failedAttempts: number
}

export interface AgentAuthHeaders {
  authorization?: string | null
  'x-agent-id'?: string | null
}

export interface AgentAuthDeps {
  findAgentByPrefix: (prefix: string) => Promise<AgentAuthRecord | null>
  recordFailedAttempt: (agentId: string, failedAttempts: number) => Promise<void>
  resetAttempts: (agentId: string) => Promise<void>
}

const API_KEY_PREFIX_LENGTH = 8
const MAX_FAILED_ATTEMPTS = 5

// Resuelve identidad del canal Scanner↔Platform (token estático por Agent), análogo pero DISTINTO
// del TenantResolver de usuarios humanos (Auth0), ver documentation/02-core-interfaces.md.
export async function resolveAgentAuth(
  headers: AgentAuthHeaders,
  deps: AgentAuthDeps,
): Promise<AgentAuthResult> {
  const token = headers.authorization?.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw new AgentAuthError('missing bearer token')

  const prefix = token.slice(0, API_KEY_PREFIX_LENGTH)
  const agent = await deps.findAgentByPrefix(prefix)
  if (!agent) throw new AgentAuthError('unknown token')

  const isValid = await bcrypt.compare(token, agent.apiKeyHash)
  if (!isValid) {
    // El umbral se aplica acá (recordFailedAttempt pone is_active=false al llegar a
    // MAX_FAILED_ATTEMPTS) — este intento sigue siendo "invalid token", el que revela
    // que quedó revocado es el siguiente request, vía el chequeo de is_active debajo.
    await deps.recordFailedAttempt(agent.id, agent.failedAttempts + 1)
    throw new AgentAuthError('invalid token')
  }

  if (!agent.is_active) throw new AgentAuthError('agent revoked')

  const headerAgentId = headers['x-agent-id']
  if (headerAgentId && headerAgentId !== agent.id) {
    throw new AgentAuthError('agent_id mismatch')
  }

  return { agentId: agent.id, officeId: agent.office, organizationId: agent.organization }
}

// depth:0 devuelve la FK cruda (string, para Offices/Organizations); con más depth vendría populado.
const relationId = (value: unknown): string =>
  typeof value === 'object' && value !== null ? (value as { id: string }).id : (value as string)

// Único punto donde el lookup de Agent toca la Local API — colección Agents no expone
// read vía access pública, por eso overrideAccess:true acá (mismo patrón que scripts/seed-agent.ts).
export function createPayloadAgentAuthDeps(payload: Payload): AgentAuthDeps {
  return {
    async findAgentByPrefix(prefix) {
      const result = await payload.find({
        collection: 'agents',
        where: { apiKeyPrefix: { equals: prefix } },
        overrideAccess: true,
        limit: 1,
        depth: 0,
      })
      const doc = result.docs[0]
      if (!doc) return null
      return {
        id: String(doc.id),
        office: relationId(doc.office),
        organization: relationId(doc.organization),
        apiKeyHash: String(doc.apiKeyHash),
        is_active: Boolean(doc.is_active),
        failedAttempts: Number(doc.failedAttempts ?? 0),
      }
    },
    async recordFailedAttempt(agentId, failedAttempts) {
      await payload.update({
        collection: 'agents',
        id: agentId,
        overrideAccess: true,
        data: {
          failedAttempts,
          ...(failedAttempts >= MAX_FAILED_ATTEMPTS ? { is_active: false } : {}),
        },
      })
    },
    async resetAttempts(agentId) {
      await payload.update({
        collection: 'agents',
        id: agentId,
        overrideAccess: true,
        data: { failedAttempts: 0 },
      })
    },
  }
}
