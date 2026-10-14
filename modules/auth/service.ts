import { httpClient } from '@/lib/http-client'
import type { PlatformAdminProfileInput } from './schema'

export type PlatformAdminProfile = PlatformAdminProfileInput & { email: string }

type LoginResponse = { exp: number; user: { id: string; email: string; name?: string | null } }

export function loginAdmin(email: string, password: string) {
  return httpClient.post<LoginResponse>('/api/admins/login', { email, password })
}

export function loginUser(email: string, password: string) {
  return httpClient.post<LoginResponse>('/api/users/login', { email, password })
}

export function getPlatformAdminProfile() {
  return httpClient.get<PlatformAdminProfile>('/api/v1/platform-admin-profile')
}

export function updatePlatformAdminProfile(input: PlatformAdminProfileInput) {
  return httpClient.patch<PlatformAdminProfile>('/api/v1/platform-admin-profile', input)
}
