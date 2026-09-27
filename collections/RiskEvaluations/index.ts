import type { CollectionConfig } from 'payload'
import { orgScopedAccess } from '@/access/rbac/orgScopedAccess'
import { whenBandVisible, whenScoreVisible } from './scoreFieldAccess'

const scoreRead = { read: whenScoreVisible }
const bandRead = { read: whenBandVisible }

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
    { name: 'rro_raw', type: 'number', required: true, access: scoreRead },
    { name: 'rro_adjusted', type: 'number', required: true, access: scoreRead },
    { name: 'riem', type: 'number', required: true, access: scoreRead },
    { name: 'score', type: 'number', access: scoreRead },
    {
      name: 'base_band',
      type: 'select',
      options: ['low', 'medium', 'high', 'critical'],
      access: bandRead,
    },
    {
      name: 'final_band',
      type: 'select',
      options: ['low', 'medium', 'high', 'critical'],
      access: bandRead,
    },
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
    { name: 'control_summary', type: 'json', required: true, access: scoreRead },
    { name: 'asset_summary', type: 'json', required: true, access: scoreRead },
  ],
}

export default RiskEvaluations
