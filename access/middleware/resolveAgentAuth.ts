import bcrypt from 'bcryptjs'
import type { Payload } from 'payload'
import {
  isAgentLockedOut,
  buildRevocationData,
  AGENT_LOCKOUT_THRESHOLD,
  AGENT_LOCKOUT_MINUTES,
  AGENT_LOCKOUT_ESCALATION_THRESHOLD,
} from '../../domain/agents/agent-state'

export class AgentAuthError extends Error {
  status: number
  constructor(message: string, status = 401) {
    super(message)
    this.status = status
  }
}

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
  lockedUntil: string | null
  lockoutCount: number
}

export interface AgentAuthHeaders {
  authorization?: string | null
  'x-agent-id'?: string | null
}

export interface AgentAuthDeps {
  findAgentByPrefix: (prefix: string) => Promise<AgentAuthRecord | null>
  recordFailedAttempt: (agent: AgentAuthRecord) => Promise<void>
  resetAttempts: (agentId: string) => Promise<void>
}

const API_KEY_PREFIX_LENGTH = 8

// Resuelve identidad del canal Scanner↔Platform (token estático por Agent), análogo pero DISTINTO
// del TenantResolver de usuarios humanos (Auth0), ver documentation/02-core-interfaces.md.
export async function resolveAgentAuth(
  headers: AgentAuthHeaders,
  deps: AgentAuthDeps
): Promise<AgentAuthResult> {
  const token = headers.authorization?.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw new AgentAuthError('missing bearer token')

  const prefix = token.slice(0, API_KEY_PREFIX_LENGTH)
  const agent = await deps.findAgentByPrefix(prefix)
  if (!agent) throw new AgentAuthError('unknown token')

  if (isAgentLockedOut(agent)) {
    throw new AgentAuthError('agent temporarily locked out', 429)
  }

  const isValid = await bcrypt.compare(token, agent.apiKeyHash)
  if (!isValid) {
    await deps.recordFailedAttempt(agent)
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
        lockedUntil: (doc.lockedUntil as string | null) ?? null,
        lockoutCount: Number(doc.lockoutCount ?? 0),
      }
    },
    // Lockout escalonado: por debajo del umbral solo se registra el intento (comportamiento
    // previo). Al llegar al umbral se bloquea temporalmente en vez de revocar de una — así un
    // tercero que solo conoce el apiKeyPrefix no puede tirar abajo un agente legítimo con un
    // burst único. Solo tras ESCALATION_THRESHOLD ciclos de lockout sostenidos se revoca de verdad.
    async recordFailedAttempt(agent) {
      const failedAttempts = agent.failedAttempts + 1
      if (failedAttempts < AGENT_LOCKOUT_THRESHOLD) {
        await payload.update({
          collection: 'agents',
          id: agent.id,
          overrideAccess: true,
          data: { failedAttempts },
        })
        return
      }

      const lockoutCount = agent.lockoutCount + 1
      if (lockoutCount >= AGENT_LOCKOUT_ESCALATION_THRESHOLD) {
        // AUDIT: this action must emit an AuditLogs entry (chain_hash over {agent, organization, office, revoked_at})
        // TODO(audit-feature): wire into domain/audit/builder.ts::addAuditEvent once AuditLog write path exists
        // NOTIFY: this event should trigger a Notification Bell entry for {org_admins of this organization}
        // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
        await payload.update({
          collection: 'agents',
          id: agent.id,
          overrideAccess: true,
          data: {
            ...buildRevocationData('auto_lockout_abuse'),
            failedAttempts: 0,
            lockoutCount,
            lockedUntil: null,
          },
        })
        return
      }

      // NOTIFY: alertar a org_admins de la organización del agente — abuso detectado, sin acción tomada aún.
      // TODO(notification-feature): no persistent notification entity exists yet — do not build one speculatively, just mark the trigger point
      await payload.update({
        collection: 'agents',
        id: agent.id,
        overrideAccess: true,
        data: {
          failedAttempts: 0,
          lockoutCount,
          lockedUntil: new Date(Date.now() + AGENT_LOCKOUT_MINUTES * 60_000).toISOString(),
        },
      })
    },
    async resetAttempts(agentId) {
      await payload.update({
        collection: 'agents',
        id: agentId,
        overrideAccess: true,
        data: { failedAttempts: 0, lockoutCount: 0, lockedUntil: null },
      })
    },
  }
}
