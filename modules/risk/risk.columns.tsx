import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { Anchor, Stack, Text } from '@mantine/core'
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge'
import { RISK_CONTROLS_V2 } from '@/domain/risk/catalog-v2'
import { RISK_PAIR_STATUS_LABEL } from '@/lib/enum-labels'
import { riskReasonLabel } from './risk-labels'
import type { RiskContributionDTO } from './service'

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
  {
    accessorKey: 'control_key',
    header: 'Qué se revisó',
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
    accessorKey: 'asset_label',
    header: 'Dónde',
    cell: ({ row }) => (
      <Stack gap={0}>
        {row.original.asset_key.startsWith('asset:') ? (
          <Anchor
            component={Link}
            href={`/portal/inventory/${row.original.asset_key.slice('asset:'.length)}`}
            size="sm"
          >
            {row.original.asset_label}
          </Anchor>
        ) : (
          <Text size="sm">{row.original.asset_label}</Text>
        )}
      </Stack>
    ),
  },
  {
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
