import type { PayloadRequest } from 'payload'

export interface ResolvedIdentity {
  externalId: string
  collection: 'users' | 'admins'
}

// Capa 1 (doc 02 §4): solo responde "quién hace esta request", no conoce OrganizationMembership
// ni RBAC. resolveTenantContext (Capa 2) depende de ResolvedIdentity, nunca de req.user crudo de
// Payload — esa es la frontera que aísla el swap futuro a Auth0.
export interface IdentityProvider {
  resolveIdentity(req: PayloadRequest): ResolvedIdentity | null
}

// Implementación actual — Payload ya resuelve req.user solo a partir de la cookie/JWT
// (o del header Authorization: JWT <token>, ver punto crítico 2 del plan), no hace falta
// llamar a ningún SDK. El día de Auth0, esta es la ÚNICA pieza que se reemplaza (por un
// auth0IdentityProvider que llama auth0.getSession() y resuelve sub -> Users/Admins vía
// UserDirectory, doc 02 §4) — resolveTenantContext, canDo y orgScopedAccess no se tocan.
//
// Limitación de plataforma a tener en cuenta (no resuelta acá, ver plan): Payload usa una
// sola cookie de sesión global — un mismo navegador no puede tener sesión de `users` y
// `admins` a la vez. Un futuro frontend que necesite ambas identidades simultáneas (ej.
// impersonar una org en una pestaña aparte) va a necesitar Bearer token explícito en vez de
// cookie para al menos una de las dos, nunca `credentials:'include'`/`withCredentials` contra
// estos endpoints.
export const payloadNativeIdentityProvider: IdentityProvider = {
  resolveIdentity(req) {
    if (!req.user) return null
    return {
      externalId: String(req.user.id),
      collection: req.user.collection as 'users' | 'admins',
    }
  },
}
