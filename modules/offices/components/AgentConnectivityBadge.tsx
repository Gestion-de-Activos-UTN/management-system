import { Tooltip } from '@mantine/core'
import { Ban, Clock3, Wifi, WifiOff } from 'lucide-react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { AgentRevocationReason } from '@/domain/agents/agent-state'

type Connectivity = 'online' | 'offline' | 'pending' | 'revoked'
type RevocationReason = AgentRevocationReason | null | undefined

// Wrapper de dominio sobre el StatusBadge genérico, para
// que online/offline/pending/revoked tengan tono propio en vez de un Badge crudo sin color.
export function AgentConnectivityBadge({
  connectivity,
  revocationReason,
}: {
  connectivity: Connectivity
  revocationReason?: RevocationReason
}) {
  const status =
    connectivity === 'revoked'
      ? {
          tone: 'danger' as const,
          label:
            revocationReason === 'auto_lockout_abuse'
              ? 'Eliminado (se detectó abuso)'
              : revocationReason === 'office_deactivated'
                ? 'Eliminado (oficina desactivada)'
                : 'Eliminado',
          icon: <Ban size={13} strokeWidth={1.5} />,
        }
      : connectivity === 'online'
        ? {
            tone: 'success' as const,
            label: 'En línea',
            icon: <Wifi size={13} strokeWidth={1.5} />,
          }
        : connectivity === 'pending'
          ? {
              tone: 'neutral' as const,
              label: 'Nunca se conectó',
              icon: <Clock3 size={13} strokeWidth={1.5} />,
            }
          : {
              tone: 'warning' as const,
              label: 'Sin conexión',
              icon: <WifiOff size={13} strokeWidth={1.5} />,
            }

  return (
    <Tooltip label={status.label}>
      <span style={{ flexShrink: 0 }}>
        <StatusBadge
          tone={status.tone}
          label={status.label}
          icon={status.icon}
          iconOnly
          size="xs"
        />
      </span>
    </Tooltip>
  )
}
