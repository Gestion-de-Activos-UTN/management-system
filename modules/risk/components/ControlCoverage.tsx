import { Card, Text } from '@mantine/core'
import { DataTable } from '@/components/ui/DataTable'
import { controlColumns } from '../risk-controls.columns'
import type { RiskEvaluationDTO } from '../service'

/** Plan §6: coverage per control beside the index, shown whatever the index visibility. */
export function ControlCoverage({ controls }: { controls: RiskEvaluationDTO['controls'] }) {
  if (!controls.length) return null
  return (
    <Card withBorder radius="lg" p="lg">
      <Text fw={750}>Información por control</Text>
      <Text size="sm" c="dimmed" mb="md">
        Cuánto incumple cada control en lo evaluado y cuánta información hay para evaluarlo. Los
        equipos más importantes para el negocio pesan más.
      </Text>
      <DataTable columns={controlColumns} data={controls} minWidth={560} maxHeight="none" />
    </Card>
  )
}
