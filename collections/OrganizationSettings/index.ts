import type { CollectionConfig } from 'payload'

// Sin lectura ni escritura externa esta fase — solo lo escribe
// domain/organizations/createOrgWithAdmin.ts vía overrideAccess. AppSettings (singleton de
// plataforma) ya existe para offline_after_hours (ver agingSweep.ts), pero risk_score_policy
// todavía no tiene lógica de default heredado — queda fuera de esta tarea.
export const OrganizationSettings: CollectionConfig = {
  slug: 'organization-settings',
  admin: {
    useAsTitle: 'industry',
  },
  access: {
    create: () => false,
    read: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'industry',
      type: 'text',
      required: true,
    },
    {
      name: 'risk_score_policy',
      type: 'json',
    },
    {
      // Umbral del job de aging (domain/inventories/agingSweep.ts) — cuánto tiempo sin aparecer en
      // un scan antes de pasar un Asset de 'active' a 'offline'. Sin override acá, cae al default
      // de plataforma en AppSettings.default_offline_after_hours, y si tampoco existe, a la
      // constante DEFAULT_OFFLINE_AFTER_HOURS en código.
      name: 'offline_after_hours',
      type: 'number',
    },
    {
      // Auto-snapshot en cada ingest (endpoints/reports.ts). Si true, ignora
      // snapshot_interval_days y toma un snapshot en CADA scan procesado.
      name: 'snapshot_before_each_scan',
      type: 'checkbox',
      defaultValue: false,
    },
    {
      // Solo aplica cuando snapshot_before_each_scan es false: cuántos días deben pasar desde el
      // último snapshot de esa office antes de tomar uno nuevo. Sin override, cae a
      // DEFAULT_SNAPSHOT_INTERVAL_DAYS.
      name: 'snapshot_interval_days',
      type: 'number',
      admin: {
        condition: data => !data?.snapshot_before_each_scan,
      },
    },
  ],
}

export default OrganizationSettings
