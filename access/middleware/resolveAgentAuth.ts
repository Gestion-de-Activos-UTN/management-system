import bcrypt from 'bcryptjs'
import type { Payload } from 'payload'

export class AgentAuthError extends Error {}

export interface AgentAuthResult {
  agentId: string
  officeId: number
  organizationId: number
}

interface AgentAuthRecord {
  id: string
  // Offices/Organizations usan el id numérico default de Payload (no los overrideamos como Agents/ScanReports).
  office: number
  organization: number
  apiKeyHash: string
  is_active: boolean
}

export interface AgentAuthHeaders {
  authorization?: string | null
  'x-agent-id'?: string | null
}

export interface AgentAuthDeps {
  findAgentByPrefix: (prefix: string) => Promise<AgentAuthRecord | null>
}

const API_KEY_PREFIX_LENGTH = 8

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
  if (!isValid) throw new AgentAuthError('invalid token')

  if (!agent.is_active) throw new AgentAuthError('agent revoked')

  const headerAgentId = headers['x-agent-id']
  if (headerAgentId && headerAgentId !== agent.id) {
    throw new AgentAuthError('agent_id mismatch')
  }

  return { agentId: agent.id, officeId: agent.office, organizationId: agent.organization }
}

// depth:0 devuelve la FK cruda (number, para Offices/Organizations); con más depth vendría populado.
const relationId = (value: unknown): number =>
  typeof value === 'object' && value !== null ? (value as { id: number }).id : (value as number)

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
      }
    },
  }
}
