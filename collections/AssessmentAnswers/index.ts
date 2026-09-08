import type { CollectionConfig } from 'payload'
import { orgScopedAccess } from '@/access/rbac/orgScopedAccess'
import { ANSWER_VALUES, COMPLIANCE_STATUSES } from '@/domain/assessments/catalog'
import { validateAssessmentAnswer } from './hooks/validateAssessmentAnswer'

export const AssessmentAnswers: CollectionConfig = {
  slug: 'assessment-answers',
  admin: { useAsTitle: 'question_key' },
  access: {
    create: () => false,
    read: orgScopedAccess('assessment-answers', 'read'),
    update: () => false,
    delete: () => false,
  },
  hooks: { beforeChange: [validateAssessmentAnswer] },
  fields: [
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      required: true,
      index: true,
    },
    {
      name: 'assessment',
      type: 'relationship',
      relationTo: 'assessment-instances',
      required: true,
      index: true,
    },
    { name: 'question_key', type: 'text', required: true, index: true },
    { name: 'question_version', type: 'number', required: true },
    { name: 'answer', type: 'select', options: [...ANSWER_VALUES], required: true },
    { name: 'justification', type: 'textarea', maxLength: 2000 },
    { name: 'evidence_note', type: 'textarea', maxLength: 4000 },
    { name: 'answered_by', type: 'relationship', relationTo: 'users', required: true },
    { name: 'answered_at', type: 'date', required: true },
    { name: 'valid_until', type: 'date', required: true, index: true },
    {
      name: 'evaluation_effect_snapshot',
      type: 'group',
      fields: [
        { name: 'status', type: 'select', options: [...COMPLIANCE_STATUSES], required: true },
        { name: 'reason_code', type: 'text', required: true },
      ],
    },
  ],
}

export default AssessmentAnswers
