import type { CollectionConfig } from 'payload'
import { orgScopedAccess } from '@/access/rbac/orgScopedAccess'
import { whenBandVisible, whenIndexVisible } from './scoreFieldAccess'

const indexRead = { read: whenIndexVisible }
const bandRead = { read: whenBandVisible }

/** Append-only output of the deficiency index (engine_version 3). Only domain/risk/persistRiskEvaluation writes. */
export const RiskEvaluations: CollectionConfig = {
  slug: 'risk-evaluations',
  admin: { useAsTitle: 'evaluated_at' },
  access: {
    create: () => false,
    read: orgScopedAccess('risk-evaluations', 'read', { kind: 'org_offices', field: 'office' }),
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      required: true,
      index: true,
    },
    { name: 'office', type: 'relationship', relationTo: 'offices', index: true },
    { name: 'catalog_version', type: 'number', required: true },
    { name: 'engine_version', type: 'number', required: true },
    { name: 'policy_key', type: 'select', options: ['essential', 'reinforced'], required: true },
    { name: 'evaluated_at', type: 'date', required: true, index: true },
    // Index, band, D_c and asset indexes follow `visibility` (Plan §6); coverage, counts,
    // warnings and context are always readable so a hidden index still explains what is missing.
    { name: 'index', type: 'number', access: indexRead },
    {
      name: 'band',
      type: 'select',
      options: ['low', 'moderate', 'high', 'very_high'],
      access: bandRead,
    },
    { name: 'coverage', type: 'number' },
    {
      name: 'visibility',
      type: 'select',
      options: ['undetermined', 'hidden', 'preliminary', 'banded'],
      required: true,
    },
    { name: 'control_summary', type: 'json', required: true, access: indexRead },
    { name: 'warnings', type: 'json', required: true },
    { name: 'asset_summary', type: 'json', required: true, access: indexRead },
    { name: 'counts', type: 'json', required: true },
    { name: 'context', type: 'json', required: true },
  ],
}

export default RiskEvaluations
