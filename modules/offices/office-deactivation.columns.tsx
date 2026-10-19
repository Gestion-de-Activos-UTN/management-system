import type { ColumnDef } from '@tanstack/react-table'
import { Checkbox, Stack, Text } from '@mantine/core'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ASSET_CATEGORY_LABEL } from '@/lib/enum-labels'
import type { ImpactedManualAsset } from '@/domain/offices/office-lifecycle'
import { RETIRE_MANUAL_ASSET } from './schema'

/**
 * Activos manuales de una oficina que se desactiva: la primera columna marca sobre cuáles se
 * aplica la acción en bloque (mover a una oficina o dar de baja); la última muestra lo decidido.
 */
export function getManualAssetDecisionColumns({
  selected,
  decisions,
  officeName,
  onToggle,
  onToggleAll,
  bulkIds,
}: {
  selected: ReadonlySet<string>
  decisions: Record<string, string>
  officeName: (id: string) => string
  onToggle: (id: string, checked: boolean) => void
  onToggleAll: (checked: boolean) => void
  /** Lo que marca la casilla del encabezado: los sin decidir, o todos si ya no queda ninguno. */
  bulkIds: string[]
}): ColumnDef<ImpactedManualAsset, unknown>[] {
  return [
    {
      id: 'select',
      size: 40,
      header: () => (
        <Checkbox
          aria-label="Seleccionar los activos sin decidir"
          checked={bulkIds.length > 0 && bulkIds.every(id => selected.has(id))}
          indeterminate={selected.size > 0 && !bulkIds.every(id => selected.has(id))}
          onChange={event => onToggleAll(event.currentTarget.checked)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={`Seleccionar ${row.original.name}`}
          checked={selected.has(row.original.id)}
          onChange={event => onToggle(row.original.id, event.currentTarget.checked)}
        />
      ),
    },
    {
      accessorKey: 'name',
      header: 'Activo',
      cell: ({ row }) => (
        <Stack gap={0} miw={0}>
          <Text size="sm" fw={600} truncate>
            {row.original.name}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {ASSET_CATEGORY_LABEL[row.original.category] ?? row.original.category}
            {row.original.owner_name ? ` · Responsable: ${row.original.owner_name}` : ''}
          </Text>
        </Stack>
      ),
    },
    {
      id: 'decision',
      header: 'Qué pasa',
      size: 200,
      cell: ({ row }) => {
        const decision = decisions[row.original.id]
        if (!decision) return <StatusBadge size="sm" tone="neutral" label="Sin decidir" />
        if (decision === RETIRE_MANUAL_ASSET)
          return <StatusBadge size="sm" tone="warning" label="Dar de baja" />
        return <StatusBadge size="sm" tone="info" label={`Mover a ${officeName(decision)}`} />
      },
    },
  ]
}
