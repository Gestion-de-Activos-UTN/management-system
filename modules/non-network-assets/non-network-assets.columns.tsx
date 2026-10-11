import type { ColumnDef } from '@tanstack/react-table'
import { Badge, Group, Stack, Text, Tooltip } from '@mantine/core'
import { OneLineText } from '@/components/ui/OneLineText'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { NonNetworkAsset } from '@/app/types/payload-types'
import { ASSET_CATEGORY_LABEL, CRITICALITY_LABEL } from '@/lib/enum-labels'
import { formatDate, formatRelativeDays } from '@/lib/format-date'
import { RowActions } from './components/RowActions'

export function getNonNetworkAssetsColumns(
  onEdit: (asset: NonNetworkAsset) => void,
  // Users.read is () => false by design (see modules/users/service.ts) — a plain `depth=1`
  // list request can't populate `owner` past its raw id (Payload's own access check on the
  // related collection blocks it, falling back to the id string). Resolve the display name
  // from the already-fetched org-members list instead of depending on relationship population.
  ownerNameById: Record<string, string>,
  asOrganization?: string
): ColumnDef<NonNetworkAsset, unknown>[] {
  return [
    {
      accessorKey: 'alias',
      header: 'Activo',
      size: 260,
      // Alias + categoría en una celda (mismo criterio que "Equipo" en assets.columns.tsx).
      cell: ({ row }) => {
        const asset = row.original
        return (
          <Stack gap={2} miw={0}>
            <Group gap="xs" wrap="nowrap" miw={0}>
              <Tooltip label={asset.alias} openDelay={400}>
                <Text size="sm" fw={600} truncate>
                  {asset.alias}
                </Text>
              </Tooltip>
              {asset.status === 'retired' && (
                <Badge size="sm" color="gray" variant="light" style={{ flexShrink: 0 }}>
                  Retirado
                </Badge>
              )}
              {asset.assessment_scope === 'excluded' && (
                <Badge size="sm" color="gray" variant="light" style={{ flexShrink: 0 }}>
                  Fuera de alcance
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed" truncate>
              {ASSET_CATEGORY_LABEL[asset.asset_category] ?? asset.asset_category}
            </Text>
          </Stack>
        )
      },
    },
    {
      accessorKey: 'criticality',
      header: 'Criticidad',
      size: 110,
      cell: ({ row }) => CRITICALITY_LABEL[row.original.criticality] ?? row.original.criticality,
    },
    {
      accessorKey: 'office',
      header: 'Oficina',
      cell: ({ row }) => {
        const office = row.original.office
        return (
          <OneLineText>{typeof office === 'object' && office ? office.name : null}</OneLineText>
        )
      },
    },
    {
      accessorKey: 'owner',
      header: 'Responsable',
      cell: ({ row }) => {
        const owner = row.original.owner
        if (typeof owner === 'object' && owner) return <OneLineText>{owner.name}</OneLineText>
        return <OneLineText>{owner ? ownerNameById[owner] : null}</OneLineText>
      },
    },
    {
      // Badge para leer el estado de un vistazo (mismo patrón que el resto de las tablas) y una
      // frase que se entiende sola ("Venció hace 3 días"); la fecha exacta queda en el tooltip.
      // Ordena por la fecha.
      accessorKey: 'next_review_at',
      header: 'Revisión',
      size: 170,
      meta: { align: 'center' },
      cell: ({ row }) => {
        const { next_review_at: nextReviewAt, review_status: reviewStatus } = row.original
        if (!nextReviewAt) {
          return (
            <Text size="xs" c="dimmed" ta="center">
              Sin revisión programada
            </Text>
          )
        }
        const overdue = reviewStatus === 'overdue'
        return (
          <Tooltip label={`Próxima revisión: ${formatDate(nextReviewAt)}`} openDelay={300}>
            <Stack gap={4} align="center">
              <StatusBadge
                tone={overdue ? 'danger' : 'success'}
                label={overdue ? 'Vencida' : 'Al día'}
              />
              <Text size="xs" c="dimmed">
                {overdue ? 'Venció' : 'Vence'} {formatRelativeDays(nextReviewAt)}
              </Text>
            </Stack>
          </Tooltip>
        )
      },
    },
    {
      id: 'actions',
      header: 'Acciones',
      size: 120,
      meta: { align: 'center' },
      cell: ({ row }) => (
        <RowActions asset={row.original} onEdit={onEdit} asOrganization={asOrganization} />
      ),
    },
  ]
}
