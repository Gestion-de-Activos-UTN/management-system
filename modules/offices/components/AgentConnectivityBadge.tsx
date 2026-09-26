import { StatusBadge } from '@/components/ui/StatusBadge'

type Connectivity = 'online' | 'offline' | 'pending' | 'revoked'
type RevocationReason = 'manual' | 'auto_lockout_abuse' | null | undefined

// Mismo patrón que ReviewStatusBadge.tsx: wrapper de dominio sobre el StatusBadge genérico, para
// que online/offline/pending/revoked tengan tono propio en vez de un Badge crudo sin color.
export function AgentConnectivityBadge({
  connectivity,
  revocationReason,
}: {
  connectivity: Connectivity
  revocationReason?: RevocationReason
}) {
  if (connectivity === 'revoked') {
    return (
      <StatusBadge
        tone="danger"
        label={
          revocationReason === 'auto_lockout_abuse' ? 'Eliminado (se detectó abuso)' : 'Eliminado'
        }
      />
    )
  }
  if (connectivity === 'online') return <StatusBadge tone="success" label="En línea" />
  if (connectivity === 'pending') return <StatusBadge tone="neutral" label="Nunca se conectó" />
  return <StatusBadge tone="warning" label="Sin conexión" />
}
