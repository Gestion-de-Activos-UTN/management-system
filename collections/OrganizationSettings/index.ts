import type { CollectionConfig } from 'payload'
import { POLICY_KEYS } from '@/domain/assessments/catalog'

// Sin lectura ni escritura externa esta fase — solo lo escribe
// domain/organizations/createOrgWithAdmin.ts vía overrideAccess. Sin AppSettings
// singleton todavía; la política de assessments es explícita, versionada y se congela al elegirla.
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
      name: 'assessment_policy_key',
      type: 'select',
      options: [...POLICY_KEYS],
      required: true,
      defaultValue: 'essential',
    },
    { name: 'assessment_policy_version', type: 'number', required: true, defaultValue: 1 },
    { name: 'assessment_policy_selected_at', type: 'date', required: true },
    { name: 'assessment_policy_selected_by', type: 'relationship', relationTo: 'users' },
    {
      // Umbral del job de aging (domain/inventories/agingSweep.ts) — cuánto tiempo sin aparecer en
      // un scan antes de pasar un Asset de 'active' a 'offline'. Sin override, cae a
      // DEFAULT_OFFLINE_AFTER_HOURS (constante en código); no hay AppSettings singleton todavía
      // para un default de plataforma editable.
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
