import type { CollectionConfig } from 'payload'
import { orgScopedAccess } from '@/access/rbac/orgScopedAccess'
import { COMPLIANCE_STATUSES } from '@/domain/assessments/catalog'
import { RISK_ASSET_TYPES } from '@/domain/risk/catalog-v2/types'

/** Immutable asset–control pairs of one RiskEvaluation, with their evidence and reasons (contracts §6). */
export const RiskContributions: CollectionConfig = {
  slug: 'risk-contributions',
  access: {
    create: () => false,
    read: orgScopedAccess('risk-contributions', 'read', { kind: 'org_offices', field: 'office' }),
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
    { name: 'asset_office', type: 'relationship', relationTo: 'offices', index: true },
    {
      name: 'asset_type',
      type: 'select',
      options: [...RISK_ASSET_TYPES],
    },
    { name: 'criticality_weight', type: 'number', required: true },
    {
      name: 'applicability',
      type: 'select',
      options: ['applicable', 'not_applicable'],
      required: true,
    },
    { name: 'compliance', type: 'number' },
    { name: 'status', type: 'select', options: [...COMPLIANCE_STATUSES], required: true },
    { name: 'reason_code', type: 'text', required: true },
    {
      // Indexed for filtering only. Never sort by it in the database: the text order is not the
      // priority order and nulls come first; order in memory with priority.ts instead.
      name: 'priority',
      type: 'select',
      options: ['low', 'medium', 'high', 'critical'],
      index: true,
    },
    { name: 'evidence', type: 'json', required: true },
    { name: 'reasons', type: 'json', required: true },
  ],
}

export default RiskContributions
