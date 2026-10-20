import type { ColumnDef } from '@tanstack/react-table'
import { ActionIcon, Button, Checkbox, Group, Popover, Stack, Text, Tooltip } from '@mantine/core'
import { Archive, ArrowRightLeft, RotateCcw } from 'lucide-react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ASSET_CATEGORY_LABEL } from '@/lib/enum-labels'
import type { ImpactedManualAsset } from '@/domain/offices/office-lifecycle'
import { RETIRE_MANUAL_ASSET } from './schema'

/**
 * Activos manuales de una oficina que se desactiva: la primera columna marca sobre cuáles se
 * aplica la acción en bloque; la última permite decidir por fila o revisar lo decidido.
 */
export function getManualAssetDecisionColumns({
  selected,
  decisions,
  officeName,
  destinations,
  movingAssetId,
  onMoveOpen,
  onDecide,
  onClearDecision,
  onToggle,
  onToggleAll,
  bulkIds,
}: {
  selected: ReadonlySet<string>
  decisions: Record<string, string>
  officeName: (id: string) => string
  destinations: { value: string; label: string }[]
  movingAssetId: string | null
  onMoveOpen: (assetId: string, opened: boolean) => void
  onDecide: (assetId: string, destination: string) => void
  onClearDecision: (assetId: string) => void
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
      header: 'Decisión',
      size: 250,
      cell: ({ row }) => {
        const assetId = row.original.id
        const decision = decisions[assetId]
        if (!decision) {
          return (
            <Group gap={6} wrap="nowrap">
              {destinations.length > 0 && (
                <Popover
                  opened={movingAssetId === assetId}
                  onChange={opened => onMoveOpen(assetId, opened)}
                  position="bottom-end"
                  withinPortal
                  shadow="md"
                >
                  <Popover.Target>
                    <Button
                      size="sm"
                      variant="light"
                      leftSection={<ArrowRightLeft size={14} strokeWidth={1.5} />}
                      aria-label={`Mover ${row.original.name} a otra oficina`}
                      onClick={() => onMoveOpen(assetId, movingAssetId !== assetId)}
                    >
                      Mover
                    </Button>
                  </Popover.Target>
                  <Popover.Dropdown p="xs" w={250}>
                    <Text size="xs" fw={700} mb={6}>
                      Mover a otra oficina
                    </Text>
                    <Stack gap={4} mah={240} style={{ overflowY: 'auto' }}>
                      {destinations.map(destination => (
                        <Button
                          key={destination.value}
                          variant="subtle"
                          color="dark"
                          size="sm"
                          justify="flex-start"
                          onClick={() => onDecide(assetId, destination.value)}
                        >
                          {destination.label}
                        </Button>
                      ))}
                    </Stack>
                  </Popover.Dropdown>
                </Popover>
              )}
              <Button
                size="sm"
                variant="light"
                color="orange"
                leftSection={<Archive size={14} strokeWidth={1.5} />}
                aria-label={`Dar de baja ${row.original.name}`}
                onClick={() => onDecide(assetId, RETIRE_MANUAL_ASSET)}
              >
                Dar de baja
              </Button>
            </Group>
          )
        }
        if (decision === RETIRE_MANUAL_ASSET)
          return (
            <Group gap="xs" wrap="nowrap">
              <StatusBadge size="sm" tone="warning" label="Dar de baja" />
              <Tooltip label="Volver a decidir">
                <ActionIcon
                  variant="light"
                  size="sm"
                  aria-label={`Cambiar decisión de ${row.original.name}`}
                  onClick={() => onClearDecision(assetId)}
                >
                  <RotateCcw size={14} strokeWidth={1.5} />
                </ActionIcon>
              </Tooltip>
            </Group>
          )
        return (
          <Group gap="xs" wrap="nowrap">
            <StatusBadge size="sm" tone="info" label={`Mover a ${officeName(decision)}`} />
            <Tooltip label="Volver a decidir">
              <ActionIcon
                variant="light"
                size="sm"
                aria-label={`Cambiar decisión de ${row.original.name}`}
                onClick={() => onClearDecision(assetId)}
              >
                <RotateCcw size={14} strokeWidth={1.5} />
              </ActionIcon>
            </Tooltip>
          </Group>
        )
      },
    },
  ]
}
