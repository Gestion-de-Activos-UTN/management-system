import type { CollectionConfig } from 'payload'
import { orgScopedAccess } from '@/access/rbac/orgScopedAccess'
import { COMPLIANCE_STATUSES, POLICY_KEYS, SEVERITIES } from '@/domain/assessments/catalog'
import { validateComplianceResult } from './hooks/validateComplianceResult'

export const ComplianceResults: CollectionConfig = {
  slug: 'compliance-results',
  admin: { useAsTitle: 'check_key' },
  access: {
    create: () => false,
    read: orgScopedAccess('compliance-results', 'read'),
    update: () => false,
    delete: () => false,
  },
  hooks: { beforeChange: [validateComplianceResult] },
  fields: [
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      required: true,
      index: true,
    },
    { name: 'office', type: 'relationship', relationTo: 'offices', index: true },
    { name: 'asset', type: 'relationship', relationTo: 'assets', index: true },
    {
      name: 'manual_asset',
      type: 'relationship',
      relationTo: 'non-network-assets',
      index: true,
    },
    { name: 'service_key', type: 'text', index: true },
    { name: 'control_key', type: 'text', required: true, index: true },
    { name: 'check_key', type: 'text', required: true, index: true },
    {
      name: 'status',
      type: 'select',
      options: [...COMPLIANCE_STATUSES],
      required: true,
      index: true,
    },
    { name: 'severity', type: 'select', options: [...SEVERITIES], required: true },
    { name: 'policy_key', type: 'select', options: [...POLICY_KEYS], required: true },
    { name: 'policy_version', type: 'number', required: true },
    { name: 'evaluated_at', type: 'date', required: true },
    { name: 'valid_until', type: 'date', required: true, index: true },
    { name: 'reason_code', type: 'text', required: true },
    { name: 'explanation', type: 'textarea', required: true, maxLength: 4000 },
    { name: 'evidence_snapshot', type: 'json', required: true },
    { name: 'supersedes', type: 'relationship', relationTo: 'compliance-results' },
  ],
}

export default ComplianceResults
