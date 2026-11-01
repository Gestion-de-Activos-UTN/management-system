import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { Anchor, Stack, Text } from '@mantine/core'
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge'
import { RISK_CONTROLS_V2 } from '@/domain/risk/catalog-v2'
import { RISK_PAIR_STATUS_LABEL } from '@/lib/enum-labels'
import { riskReasonLabel } from './risk-labels'
import type { RiskContributionDTO } from './service'
import { usePortalHref } from '@/lib/use-portal-href'
import { riskAssetPath } from '@/modules/assets/asset-path'

// La clave del par ya dice de dónde viene el activo: `asset:` lo detectó el escáner,
// `manual:` lo cargó una persona (ver domain/risk/build-pairs.ts).
function AssetCell({ assetKey, label }: { assetKey: string; label: string }) {
  const href = usePortalHref()
  const scanned = assetKey.startsWith('asset:')
  const path = riskAssetPath(assetKey)
  return (
    <Stack gap={0}>
      {path ? (
        <Anchor component={Link} href={href(path)} size="sm">
          {label}
        </Anchor>
      ) : (
        <Text size="sm">{label}</Text>
      )}
      <Text size="xs" c="dimmed">
        {scanned ? 'Detectado por escáner' : 'Activo manual'}
      </Text>
    </Stack>
  )
}

const STATUS_TONE: Record<RiskContributionDTO['status'], StatusTone> = {
  compliant: 'success',
  partially_effective: 'warning',
  non_compliant: 'danger',
  not_evaluable: 'neutral',
}

const CONTROL_TITLE = new Map<string, string>(
  RISK_CONTROLS_V2.map(control => [control.key, control.title])
)

export const controlTitle = (key: string) => CONTROL_TITLE.get(key) ?? key

const resultExplanation = (row: RiskContributionDTO) => {
  if (row.excluded) return 'Este dispositivo no forma parte de la revisión.'
  if (row.status === 'compliant') return 'La protección comprobada es adecuada.'
  if (row.status === 'partially_effective') return 'La protección existe, pero conviene mejorarla.'
  if (row.status === 'non_compliant') return 'No se encontró la protección esperada.'
  return 'Falta información para confirmar si existe protección.'
}

export const riskContributionsColumns: ColumnDef<RiskContributionDTO, unknown>[] = [
  // Los id coinciden con RISK_SORT_KEYS: el orden lo resuelve el servidor sobre toda la evaluación.
  {
    id: 'control',
    accessorKey: 'control_key',
    header: 'Control',
    cell: ({ row }) => (
      <Stack gap={0}>
        <Text size="sm" fw={600}>
          {controlTitle(row.original.control_key)}
        </Text>
        <Text size="xs" c="dimmed">
          Control {row.original.control_key}
        </Text>
      </Stack>
    ),
  },
  {
    id: 'asset',
    accessorKey: 'asset_label',
    header: 'Activo',
    cell: ({ row }) => (
      <AssetCell assetKey={row.original.asset_key} label={row.original.asset_label} />
    ),
  },
  {
    id: 'status',
    accessorKey: 'status',
    header: 'Resultado',
    cell: ({ row }) =>
      row.original.excluded ? (
        <StatusBadge tone="neutral" label="Excluido" />
      ) : (
        <StatusBadge
          tone={STATUS_TONE[row.original.status]}
          label={
            row.original.status === 'non_compliant'
              ? 'Requiere atención'
              : RISK_PAIR_STATUS_LABEL[row.original.status]
          }
        />
      ),
  },
  {
    id: 'meaning',
    header: 'Qué significa',
    cell: ({ row }) => {
      // The specific reason says what to do next; the generic sentence explains the result.
      const reason = riskReasonLabel(row.original)
      return (
        <Stack gap={0}>
          <Text size="sm">{resultExplanation(row.original)}</Text>
          {reason && (
            <Text size="xs" c="dimmed">
              {reason}
            </Text>
          )}
        </Stack>
      )
    },
  },
]
