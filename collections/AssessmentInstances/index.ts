import type { CollectionConfig } from 'payload'
import { orgScopedAccess } from '@/access/rbac/orgScopedAccess'
import { POLICY_KEYS } from '@/domain/assessments/catalog'
import { validateAssessmentInstance } from './hooks/validateAssessmentInstance'

export const AssessmentInstances: CollectionConfig = {
  slug: 'assessment-instances',
  admin: { useAsTitle: 'id' },
  access: {
    create: () => false,
    read: orgScopedAccess('assessment-instances', 'read'),
    update: () => false,
    delete: () => false,
  },
  hooks: { beforeChange: [validateAssessmentInstance] },
  fields: [
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      required: true,
      index: true,
    },
    {
      name: 'scope',
      type: 'select',
      options: ['organization', 'office', 'asset'],
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
    { name: 'policy_key', type: 'select', options: [...POLICY_KEYS], required: true },
    { name: 'policy_version', type: 'number', required: true },
    { name: 'catalog_version', type: 'number', required: true },
    { name: 'question_set_snapshot', type: 'json', required: true },
    {
      name: 'status',
      type: 'select',
      options: ['pending', 'in_progress', 'completed', 'expired', 'superseded'],
      required: true,
      defaultValue: 'pending',
      index: true,
    },
    { name: 'assigned_to', type: 'relationship', relationTo: 'users' },
    {
      name: 'created_reason',
      type: 'select',
      options: [
        'initial',
        'asset_identified',
        'assessment_scope_changed',
        'policy_changed',
        'answer_expired',
        'manual_review',
      ],
      required: true,
    },
    { name: 'opened_at', type: 'date', required: true },
    { name: 'due_at', type: 'date', required: true, index: true },
    { name: 'completed_at', type: 'date' },
    { name: 'completed_by', type: 'relationship', relationTo: 'users' },
    {
      name: 'completion_summary',
      type: 'group',
      fields: [
        { name: 'compliant', type: 'number', required: true, defaultValue: 0 },
        { name: 'non_compliant', type: 'number', required: true, defaultValue: 0 },
        { name: 'not_evaluable', type: 'number', required: true, defaultValue: 0 },
      ],
    },
  ],
}

export default AssessmentInstances
