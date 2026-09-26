import type { CollectionConfig } from 'payload'
import { orgScopedAccess } from '@/access/rbac/orgScopedAccess'

/** Immutable, auditable per asset/control inputs and outputs for one RiskEvaluation. */
export const RiskContributions: CollectionConfig = {
  slug: 'risk-contributions',
  access: {
    create: () => false,
    read: orgScopedAccess('risk-contributions', 'read'),
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
    {
      name: 'evaluation',
      type: 'relationship',
      relationTo: 'risk-evaluations',
      required: true,
      index: true,
    },
    { name: 'asset_key', type: 'text', required: true, index: true },
    { name: 'asset', type: 'relationship', relationTo: 'assets', index: true },
    { name: 'manual_asset', type: 'relationship', relationTo: 'non-network-assets', index: true },
    { name: 'control_key', type: 'text', required: true, index: true },
    {
      name: 'criticality',
      type: 'select',
      options: ['low', 'medium', 'high', 'critical', 'unknown'],
      required: true,
    },
    { name: 'scope_multiplier', type: 'number', required: true },
    {
      name: 'severity',
      type: 'select',
      options: ['low', 'medium', 'high', 'critical', 'unknown'],
      required: true,
    },
    { name: 'exposure', type: 'select', options: ['low', 'medium', 'high'], required: true },
    { name: 'exposure_source', type: 'select', options: ['scan', 'default_unknown'] },
    { name: 'efficacy', type: 'number' },
    { name: 'effect_snapshot', type: 'json', required: true },
    {
      name: 'status',
      type: 'select',
      options: ['compliant', 'partially_effective', 'non_compliant', 'not_evaluable'],
      required: true,
    },
    { name: 'inherent_risk', type: 'number' },
    { name: 'residual_risk', type: 'number' },
    { name: 'coverage_weight', type: 'number', required: true },
    { name: 'excluded', type: 'checkbox', required: true },
    { name: 'reason_code', type: 'text', required: true },
  ],
}

export default RiskContributions
