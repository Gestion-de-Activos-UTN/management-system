import type { CollectionConfig } from 'payload'
import { orgScopedAccess } from '@/access/rbac/orgScopedAccess'

/** Append-only output of the deterministic risk engine. Only domain/risk/persistRiskEvaluation writes. */
export const RiskEvaluations: CollectionConfig = {
  slug: 'risk-evaluations',
  admin: { useAsTitle: 'evaluated_at' },
  access: {
    create: () => false,
    read: orgScopedAccess('risk-evaluations', 'read'),
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
    { name: 'rro_raw', type: 'number', required: true },
    { name: 'rro_adjusted', type: 'number', required: true },
    { name: 'riem', type: 'number', required: true },
    { name: 'score', type: 'number' },
    { name: 'base_band', type: 'select', options: ['low', 'medium', 'high', 'critical'] },
    { name: 'final_band', type: 'select', options: ['low', 'medium', 'high', 'critical'] },
    { name: 'coverage', type: 'number', required: true },
    { name: 'unknown_percentage', type: 'number', required: true },
    {
      name: 'confidence',
      type: 'select',
      options: ['hidden', 'preliminary', 'warning', 'usable', 'reliable'],
      required: true,
    },
    {
      name: 'effective_confidence',
      type: 'select',
      options: ['hidden', 'preliminary', 'warning', 'usable', 'reliable'],
      required: true,
    },
    { name: 'counts', type: 'json', required: true },
    { name: 'alerts', type: 'json', required: true },
    { name: 'control_summary', type: 'json', required: true },
    { name: 'asset_summary', type: 'json', required: true },
  ],
}

export default RiskEvaluations
