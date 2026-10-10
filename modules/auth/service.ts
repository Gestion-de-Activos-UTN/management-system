import { httpClient } from '@/lib/http-client'

type LoginResponse = { exp: number; user: { id: string; email: string } }

export function loginAdmin(email: string, password: string) {
  return httpClient.post<LoginResponse>('/api/admins/login', { email, password })
}

export function loginUser(email: string, password: string) {
  return httpClient.post<LoginResponse>('/api/users/login', { email, password })
}
