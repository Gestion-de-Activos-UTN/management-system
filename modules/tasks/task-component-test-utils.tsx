import { type ReactNode } from 'react'
import { MantineProvider } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'
import { httpClient } from '@/lib/http-client'
import { theme } from '@/lib/theme'
import type { TaskDTO } from './service'

export const officeId = '11111111-1111-4111-8111-111111111111'
export const otherOfficeId = '22222222-2222-4222-8222-222222222222'
export const referenceId = '33333333-3333-4333-8333-333333333333'

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export function task(overrides: Partial<TaskDTO> = {}): TaskDTO {
  return {
    id: 'task-12',
    title: 'Tarea de prueba',
    description: 'Descripción original',
    organization: 'organization-test',
    office: officeId,
    priority: 'normal',
    status: 'in_progress',
    effective_status: 'in_progress',
    assignment_kind: 'open_pool',
    start_at: '2026-10-30T09:00:00.000Z',
    createdAt: '2026-10-30T09:00:00.000Z',
    updatedAt: '2026-10-30T09:00:00.000Z',
    created_by: { relationTo: 'users', value: 'admin-test' },
    related_entity_info: null,
    available_actions: ['complete', 'release'],
    requires_reassignment: false,
    assignment_info: { office_name: 'Centro Logístico Rosario', role_name: null, user_name: null },
    ...overrides,
  }
}

export function componentFixture() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  })
  const toast = vi.spyOn(notifications, 'show').mockReturnValue('test-toast')
  const get = vi.spyOn(httpClient, 'get').mockImplementation(async path => {
    if (path === '/api/v1/session')
      return {
        userId: 'admin-test',
        orgWide: true,
        isActive: true,
        role: 'org_admin',
        organizationId: 'organization-test',
        officeIds: [officeId, otherOfficeId],
        permissions: { tasks: ['create', 'edit', 'reassign'], assets: [] },
      } as never
    if (path === '/api/offices')
      return {
        docs: [
          { id: officeId, name: 'Centro Logístico Rosario', is_active: true },
          { id: otherOfficeId, name: 'Casa Central Palermo', is_active: true },
        ],
      } as never
    if (path === '/api/v1/tasks/assignment-options')
      return {
        roles: [
          { id: 'role-manager', slug: 'office_manager' },
          { id: 'role-viewer', slug: 'org_viewer' },
        ],
        users: [
          {
            id: 'viewer-test',
            name: 'Diego Martínez',
            email: 'diego@example.test',
            role_id: 'role-viewer',
            role: 'org_viewer',
          },
        ],
      } as never
    if (path === '/api/v1/tasks/reference-options')
      return {
        docs: [
          {
            relationTo: 'assets',
            value: referenceId,
            label: 'Servidor contable',
            office_id: officeId,
          },
        ],
      } as never
    throw new Error(`Unexpected GET ${path}`)
  })
  const post = vi.spyOn(httpClient, 'post').mockRejectedValue(new Error('Unexpected POST'))
  const patch = vi.spyOn(httpClient, 'patch').mockRejectedValue(new Error('Unexpected PATCH'))
  const remove = vi.spyOn(httpClient, 'delete').mockRejectedValue(new Error('Unexpected DELETE'))
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MantineProvider theme={theme}>{children}</MantineProvider>
      </QueryClientProvider>
    )
  }
  return { client, toast, get, post, patch, remove, Wrapper }
}
