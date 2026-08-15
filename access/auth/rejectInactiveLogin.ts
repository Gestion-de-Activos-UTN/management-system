import type { CollectionBeforeLoginHook } from 'payload'

// Sin esto, Payload emite un JWT válido para un status='inactive' igual (no conoce
// nuestro campo de negocio) y el rechazo recién llegaría al primer chequeo de RBAC.
// Con este hook, el login mismo rechaza con 403 — explícito, no silencioso.
export const rejectInactiveLogin: CollectionBeforeLoginHook = ({ user }) => {
  if ((user as { status?: string }).status !== 'active') {
    throw new Error('Cuenta inactiva')
  }
}
