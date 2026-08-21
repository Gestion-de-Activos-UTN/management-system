import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import type { CollectionConfig } from 'payload'

// Un heartbeat perdido no debe marcar el agente offline de inmediato (jitter de red) —
// tolera hasta 2 ciclos de heartbeat antes de considerarlo caído. Ver HEARTBEAT_INTERVAL_SECONDS
// en scanner-prototype/src/siam_agent/config.py (hoy 300s).
const HEARTBEAT_INTERVAL_SECONDS = 300
const OFFLINE_THRESHOLD_SECONDS = HEARTBEAT_INTERVAL_SECONDS * 2

const isOnline = (lastHeartbeatAt: string | null | undefined): boolean => {
  if (!lastHeartbeatAt) return false
  const elapsedSeconds = (Date.now() - new Date(lastHeartbeatAt).getTime()) / 1000
  return elapsedSeconds <= OFFLINE_THRESHOLD_SECONDS
}

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
      name: 'last_heartbeat_at',
      type: 'date',
    },
    {
      // Derivado, nunca persistido ni escrito directo desde un payload de ingesta.
      name: 'status',
      type: 'select',
      options: ['online', 'offline'],
      virtual: true,
      hooks: {
        afterRead: [
          ({ siblingData }) => (isOnline(siblingData.last_heartbeat_at) ? 'online' : 'offline'),
        ],
      },
    },
    {
      name: 'is_active',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'false = token revocado, rechazar toda ingesta de este agente',
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
      ({ data, operation, req }) => {
        if (operation !== 'create') return data
        const plainApiKey = generateApiKey()
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
