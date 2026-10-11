import { httpClient } from '@/lib/http-client'
import type { PlatformAdminProfileInput } from './schema'

type LoginResponse = { exp: number; user: { id: string; email: string } }

export function loginAdmin(email: string, password: string) {
  return httpClient.post<LoginResponse>('/api/admins/login', { email, password })
}

export function loginUser(email: string, password: string) {
  return httpClient.post<LoginResponse>('/api/users/login', { email, password })
}

export function getPlatformAdminProfile() {
  return httpClient.get<PlatformAdminProfileInput>('/api/v1/platform-admin-profile')
}

export function updatePlatformAdminProfile(input: PlatformAdminProfileInput) {
  return httpClient.patch<PlatformAdminProfileInput>('/api/v1/platform-admin-profile', input)
}
