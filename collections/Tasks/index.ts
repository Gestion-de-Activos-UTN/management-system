import type { CollectionBeforeValidateHook, CollectionConfig } from 'payload'
import { effectiveTaskStatus, isTaskOverdue } from '@/domain/tasks/task-state'
import {
  TASK_ASSIGNMENT_KINDS,
  TASK_PRIORITIES,
  TASK_REFERENCE_COLLECTIONS,
} from '@/modules/tasks/schema'

const serverOnly = { create: () => false, update: () => false }

export const defaultTaskStartAt: CollectionBeforeValidateHook = ({ data, operation }) => {
  if (operation !== 'create' || !data) return data
  const startAt = data.start_at || new Date().toISOString()
  return {
    ...data,
    start_at: startAt,
    initial_due_at: data.initial_due_at ?? data.due_at ?? null,
  }
}

export const Tasks: CollectionConfig = {
  slug: 'tasks',
  admin: { useAsTitle: 'title' },
  access: {
    // Las lecturas también pasan por endpoints propios: además del tenant scope hay que comprobar
    // el permiso del actor sobre la entidad polimórfica relacionada.
    create: () => false,
    read: () => false,
    update: () => false,
    delete: () => false,
  },
  hooks: { beforeValidate: [defaultTaskStartAt] },
  fields: [
    { name: 'title', type: 'text', required: true, minLength: 3, maxLength: 160 },
    { name: 'description', type: 'textarea', maxLength: 5000 },
    {
      name: 'priority',
      type: 'select',
      required: true,
      defaultValue: 'normal',
      options: [...TASK_PRIORITIES],
      index: true,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: ['pending', 'in_progress', 'completed', 'cancelled'],
      index: true,
      access: serverOnly,
    },
    { name: 'start_at', type: 'date', required: true, index: true },
    { name: 'due_at', type: 'date', index: true },
    { name: 'initial_due_at', type: 'date', access: serverOnly, admin: { readOnly: true } },
    {
      name: 'effective_status',
      type: 'text',
      virtual: true,
      admin: { readOnly: true },
      hooks: { afterRead: [({ siblingData }) => effectiveTaskStatus(siblingData)] },
    },
    {
      name: 'is_overdue',
      type: 'checkbox',
      virtual: true,
      admin: { readOnly: true },
      hooks: { afterRead: [({ siblingData }) => isTaskOverdue(siblingData)] },
    },
    {
      name: 'assignment_kind',
      type: 'select',
      required: true,
      options: [...TASK_ASSIGNMENT_KINDS],
      index: true,
    },
    { name: 'assigned_role', type: 'relationship', relationTo: 'roles' },
    { name: 'assigned_user', type: 'relationship', relationTo: 'users', index: true },
    { name: 'claimed_by', type: 'relationship', relationTo: 'users', access: serverOnly },
    { name: 'claimed_at', type: 'date', access: serverOnly },
    { name: 'completed_by', type: 'relationship', relationTo: 'users', access: serverOnly },
    { name: 'completed_at', type: 'date', access: serverOnly },
    { name: 'cancelled_by', type: 'relationship', relationTo: 'users', access: serverOnly },
    { name: 'cancelled_at', type: 'date', access: serverOnly },
    { name: 'cancellation_reason', type: 'textarea', maxLength: 500, access: serverOnly },
    { name: 'archived_by', type: 'relationship', relationTo: 'users', access: serverOnly },
    { name: 'archived_at', type: 'date', access: serverOnly, index: true },
    {
      name: 'related_entity',
      type: 'relationship',
      relationTo: [...TASK_REFERENCE_COLLECTIONS],
      hasMany: false,
    },
    {
      name: 'organization',
      type: 'relationship',
      relationTo: 'organizations',
      required: true,
      index: true,
      access: serverOnly,
      admin: { readOnly: true },
    },
    {
      name: 'office',
      type: 'relationship',
      relationTo: 'offices',
      index: true,
      access: serverOnly,
      admin: { readOnly: true },
    },
    {
      name: 'created_by',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      access: serverOnly,
      admin: { readOnly: true },
    },
    { name: 'creation_batch_id', type: 'text', index: true, access: serverOnly },
  ],
}

export default Tasks
