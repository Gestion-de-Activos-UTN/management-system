import type { ColumnDef } from '@tanstack/react-table'
import { Stack, Text } from '@mantine/core'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { CONTROL_WARNING, type ControlIndex } from '@/domain/risk/deficiency-index'
import { HeaderHint, Hint } from './components/HeaderHint'
import { controlTitle } from './risk-labels'

const percent = (value: number) => `${Math.round(value * 100)} %`

const WARNING_HINT = `Control importante (importancia ${CONTROL_WARNING.minImportance} o más) con menos del ${CONTROL_WARNING.belowCoverage} % de información: su deficiencia puede cambiar al completarla.`

// Server order, no sortable columns: same rule as the two lists (contracts §7).
export const controlColumns: ColumnDef<ControlIndex, unknown>[] = [
  {
    id: 'control',
    header: 'Control',
    enableSorting: false,
    cell: ({ row }) => (
      <Stack gap={0}>
        <Text size="sm" fw={600}>
          {controlTitle(row.original.control_key)}
        </Text>
        <Text size="xs" c="dimmed">
          {row.original.control_key}
        </Text>
      </Stack>
    ),
  },
  {
    id: 'importance',
    header: () => (
      <HeaderHint
        label="Importancia"
        hint="Peso fijo del control en el índice: 8, 4, 2 o 1. Cuanto más alto, más pesa su incumplimiento en el resultado general."
      />
    ),
    size: 110,
    enableSorting: false,
    cell: ({ row }) => <Text size="sm">{row.original.importance} de 8</Text>,
  },
  {
    id: 'deficiency',
    header: () => (
      <HeaderHint
        label="Deficiencia"
        hint="Qué parte de lo evaluado en este control no cumple: 0 % todo cumple, 100 % nada cumple. Los equipos más críticos pesan más. Se oculta mientras haya poca información."
      />
    ),
    size: 110,
    enableSorting: false,
    // null when the index is not visible (contracts §10.5).
    cell: ({ row }) => (
      <Text size="sm">
        {row.original.deficiency === null ? '—' : percent(row.original.deficiency)}
      </Text>
    ),
  },
  {
    id: 'coverage',
    header: () => (
      <HeaderHint
        label="Información disponible"
        hint="Qué parte de lo que corresponde revisar en este control tiene información vigente. Con poca información, la deficiencia es menos representativa."
      />
    ),
    enableSorting: false,
    cell: ({ row }) => {
      const { coverage, evaluated_pairs, pending_pairs, warning } = row.original
      return (
        <Stack gap={4} align="flex-start">
          <Stack gap={0}>
            <Text size="sm">{percent(coverage)}</Text>
            <Text size="xs" c="dimmed">
              {evaluated_pairs} de {evaluated_pairs + pending_pairs} comprobaciones
            </Text>
          </Stack>
          {warning && (
            <Hint hint={WARNING_HINT}>
              {/* StatusBadge no reenvía ref: el span le da al Tooltip un ancla. */}
              <span tabIndex={0} style={{ display: 'inline-block' }}>
                <StatusBadge tone="warning" label="Información limitada" />
              </span>
            </Hint>
          )}
        </Stack>
      )
    },
  },
]
