import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import type { CollectionConfig } from 'payload'
import {
  AGENT_LIFECYCLE_STATUSES,
  AGENT_RUNTIME_STATUSES,
  AGENT_REVOCATION_REASONS,
  assertAgentTransition,
  getAgentLifecycleStatus,
  isAgentOnline,
} from '../../domain/agents/agent-state'

const API_KEY_PREFIX_LENGTH = 8

const generateApiKey = () => crypto.randomBytes(32).toString('hex')

// TODO(rbac-feature): reemplazar por access real cuando exista TenantContext/RBAC (documentation/02-core-interfaces.md §4)
export const Agents: CollectionConfig = {
  slug: 'agents',
  admin: {
    useAsTitle: 'id',
  },
  access: {
    create: () => false,
    read: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'id',
      type: 'text',
      required: true,
      unique: true,
      admin: {
        description: 'agent_id tal cual lo manda el escáner (ej. agent-001)',
      },
    },
    {
      name: 'office',
      type: 'relationship',
      relationTo: 'offices',
      required: true,
      index: true,
    },
    {
      // Denormalizado desde `office` — nunca editable a mano, ver hook deriveOrganizationFromOffice.
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'provisioned_at',
      type: 'date',
      defaultValue: () => new Date().toISOString(),
      admin: { readOnly: true },
    },
    {
      name: 'first_heartbeat_at',
      type: 'date',
      admin: { readOnly: true },
    },
    {
      name: 'last_heartbeat_at',
      type: 'date',
      admin: { readOnly: true },
    },
    {
      name: 'last_agent_timestamp',
      type: 'date',
      admin: { readOnly: true },
    },
    {
      name: 'runtime_status',
      type: 'select',
      options: [...AGENT_RUNTIME_STATUSES],
      defaultValue: 'unknown',
      admin: { readOnly: true },
    },
    {
      name: 'lifecycle_status',
      type: 'select',
      options: [...AGENT_LIFECYCLE_STATUSES],
      defaultValue: 'provisioned',
      index: true,
      admin: { readOnly: true },
    },
    {
      // Derivado, nunca persistido ni escrito directo desde un payload de ingesta.
      name: 'status',
      type: 'select',
      options: ['online', 'offline'],
      virtual: true,
      hooks: {
        afterRead: [
          ({ siblingData }) =>
            getAgentLifecycleStatus(siblingData) === 'revoked'
              ? 'offline'
              : isAgentOnline({ last_heartbeat_at: siblingData.last_heartbeat_at })
                ? 'online'
                : 'offline',
        ],
      },
    },
    {
      name: 'is_active',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        hidden: true,
        description:
          'Compatibilidad: false = token revocado. Usar lifecycle_status en código nuevo.',
      },
    },
    {
      name: 'revoked_at',
      type: 'date',
      admin: { readOnly: true },
    },
    {
      name: 'revocation_reason',
      type: 'select',
      options: [...AGENT_REVOCATION_REASONS],
      admin: {
        readOnly: true,
        description: 'Motivo de la revocación: manual (acción humana) o auto_lockout_abuse.',
      },
    },
    {
      // Solo cuenta intentos con apiKeyPrefix correcto pero hash inválido — un prefix
      // desconocido no llega a asociarse a ningún Agent (resolveAgentAuth.ts). Se resetea
      // a 0 en cada ingesta exitosa (reports.ts/heartbeat.ts), no solo en el auth.
      name: 'failedAttempts',
      type: 'number',
      defaultValue: 0,
      admin: { readOnly: true },
    },
    {
      // Bloqueo temporal tras superar AGENT_LOCKOUT_THRESHOLD fallidos — ver resolveAgentAuth.ts.
      name: 'lockedUntil',
      type: 'date',
      admin: { readOnly: true },
    },
    {
      // Ciclos de lockout acumulados; al llegar a AGENT_LOCKOUT_ESCALATION_THRESHOLD se revoca.
      name: 'lockoutCount',
      type: 'number',
      defaultValue: 0,
      admin: { readOnly: true },
    },
    {
      name: 'apiKeyPrefix',
      type: 'text',
      unique: true,
      index: true,
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'apiKeyHash',
      type: 'text',
      admin: {
        hidden: true,
      },
    },
    {
      // Solo poblado por attachPlainApiKeyOnce en la respuesta de creación — nunca se persiste ni se rehidrata en lecturas.
      name: 'apiKey',
      type: 'text',
      virtual: true,
      admin: {
        readOnly: true,
        description: 'Solo visible una vez, en la respuesta de creación.',
      },
    },
  ],
  hooks: {
    beforeValidate: [
      // Corre siempre (create y update) para que ningún update pueda desincronizar el denormalizado.
      async ({ data, req }) => {
        if (!data?.office) return data
        const office = await req.payload.findByID({
          collection: 'offices',
          id: data.office as string,
          depth: 0,
          req,
        })
        return { ...data, organization: office.organization }
      },
      // `office` se asigna una sola vez, al aprovisionar — inmutable después.
      ({ data, operation, originalDoc }) => {
        if (
          operation === 'update' &&
          originalDoc?.office &&
          data?.office &&
          String(data.office) !== String(originalDoc.office)
        ) {
          throw new Error('Agents.office es inmutable después de la creación')
        }
        return data
      },
    ],
    beforeChange: [
      ({ data, operation, originalDoc }) => {
        const previous = getAgentLifecycleStatus(originalDoc ?? {})
        const next = getAgentLifecycleStatus({ ...originalDoc, ...data })
        if (operation === 'update') assertAgentTransition(previous, next)
        return {
          ...data,
          lifecycle_status: next,
          is_active: next !== 'revoked',
        }
      },
      ({ data, operation, req }) => {
        if (operation !== 'create') return data
        // `seedApiKey` es un canal de dev-seed y `provisionApiKey` es el canal interno del
        // endpoint de provisioning. Ninguno llega desde una request pública: Agents.create
        // permanece cerrado por access y ambos valores se inyectan mediante req.context.
        const plainApiKey =
          (req.context.provisionApiKey as string | undefined) ||
          (req.context.seedApiKey as string | undefined) ||
          generateApiKey()
        req.context.plainApiKey = plainApiKey
        return {
          ...data,
          apiKeyPrefix: plainApiKey.slice(0, API_KEY_PREFIX_LENGTH),
          apiKeyHash: bcrypt.hashSync(plainApiKey, 10),
        }
      },
    ],
    afterChange: [
      ({ doc, operation, req }) => {
        if (operation === 'create' && req.context.plainApiKey) {
          return { ...doc, apiKey: req.context.plainApiKey }
        }
        return doc
      },
    ],
  },
}

export default Agents
