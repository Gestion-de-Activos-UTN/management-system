import { httpClient } from '@/lib/http-client'
import type { PortalMessageInput } from './schema'

export type PortalMessageDTO = {
  id: string
  delivery_version: number
  title: string
  description: string
  message_type: 'notice' | 'actionable'
  cta_label?: string | null
  createdAt?: string
  seen: boolean
  dismissed: boolean
  entity: null | {
    relationTo: string
    value?: string
    label?: string
    href?: string | null
    access: 'allowed' | 'denied' | 'unavailable'
  }
}

export type PortalMessageRecord = Omit<PortalMessageInput, 'message_type'> & {
  id: string
  delivery_version: number
  message_type: 'notice' | 'actionable'
  createdAt?: string
}

export type AdminPortalMessageOptions = {
  organizations: Array<{ id: string; name: string }>
  roles: Array<{ id: string; slug: string; name: string }>
  users: Array<{ id: string; organization_id: string; name: string; email: string; role: string }>
  docs: PortalMessageRecord[]
}

export type PortalMessageEntityOption = { relationTo: string; value: string; label: string }

export function listAdminPortalMessages(organizationIds: string[]) {
  return httpClient.get<AdminPortalMessageOptions>('/api/v1/platform-admin/portal-messages', {
    organization_id: organizationIds.join(','),
  })
}

export function listPortalMessageEntityOptions(
  scope: 'global' | 'organizations',
  organizationIds: string[],
  type: string
) {
  return httpClient
    .get<{ docs: PortalMessageEntityOption[] }>('/api/v1/platform-admin/portal-message-entities', {
      scope,
      organization_id: organizationIds.join(','),
      type,
    })
    .then(response => response.docs)
}

export function savePortalMessage(input: PortalMessageInput, id?: string) {
  return id
    ? httpClient.patch<PortalMessageRecord>(`/api/v1/platform-admin/portal-messages/${id}`, input)
    : httpClient.post<PortalMessageRecord>('/api/v1/platform-admin/portal-messages', input)
}

export function replayPortalMessage(id: string) {
  return httpClient.post<{ ok: boolean; delivery_version: number }>(
    `/api/v1/platform-admin/portal-messages/${id}/replay`,
    {}
  )
}

export function listMyPortalMessages() {
  return httpClient
    .get<{ docs: PortalMessageDTO[] }>('/api/v1/portal-messages')
    .then(response => response.docs)
}

export function updatePortalMessageReceipt(
  id: string,
  status: 'seen' | 'dismissed',
  deliveryVersion: number
) {
  return httpClient.patch<{ ok: boolean }>(`/api/v1/portal-messages/${id}/receipt`, {
    status,
    delivery_version: deliveryVersion,
  })
}

export function resolvePortalMessageLink(id: string) {
  return httpClient
    .get<{ url: string | null }>(`/api/v1/portal-messages/${id}/resolve-link`)
    .then(response => response.url)
    .catch(() => null)
}
