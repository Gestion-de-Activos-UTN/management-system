import type { CollectionConfig } from 'payload'
import { canDoAccess } from '@/access/rbac/orgScopedAccess'

// Un row por corrida de un job interno (hoy solo aging_sweep, disparado a mano vía
// endpoints/internalJobs.ts hasta que exista un scheduler real — ver esa nota). No hay
// JobRunEvent (granularidad por paso): aging_sweep es una sola operación, sin pasos internos
// que valga la pena trazar por separado todavía.
export const JobRun: CollectionConfig = {
  slug: 'job-runs',
  admin: {
    useAsTitle: 'job_type',
  },
  access: {
    create: () => false, // solo lo escribe domain/inventories/agingSweep.ts vía overrideAccess
    read: canDoAccess('job-runs', 'read'), // catálogo operativo, no scoped por organización — solo platform_admin
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'job_type',
      type: 'select',
      options: ['aging_sweep'],
      required: true,
    },
    { name: 'started_at', type: 'date', required: true },
    { name: 'finished_at', type: 'date' },
    {
      name: 'status',
      type: 'select',
      options: ['running', 'success', 'failed'],
      required: true,
      defaultValue: 'running',
    },
    { name: 'summary', type: 'json' }, // { assets_transitioned: number, organizations_processed: number }
    { name: 'error', type: 'text' },
  ],
}

export default JobRun
