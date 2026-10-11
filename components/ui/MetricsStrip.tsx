import type { ReactNode } from 'react'
import { Group, Paper, SimpleGrid, Skeleton, Text } from '@mantine/core'
import type { LucideIcon } from 'lucide-react'

export type StripMetric = { key: string; icon: LucideIcon; value: ReactNode; label: string }

/**
 * Franja de cifras compactas (ícono, valor, etiqueta): informa sin competir con el contenido
 * principal. Panel general, uso del plan en Administración… Una columna por cifra en anchos
 * medianos, 2 en pantallas angostas.
 */
export function MetricsStrip({
  metrics,
  isPending,
}: {
  metrics: StripMetric[]
  isPending: boolean
}) {
  if (isPending) return <Skeleton height={68} radius="lg" />
  return (
    <Paper withBorder radius="lg" px="md" py="sm">
      <SimpleGrid cols={{ base: 2, sm: metrics.length }} spacing="md" verticalSpacing="sm">
        {metrics.map(metric => (
          <div key={metric.key} style={{ minWidth: 0 }}>
            <Group gap={6} wrap="nowrap">
              <metric.icon size={16} strokeWidth={1.5} style={{ flexShrink: 0, opacity: 0.7 }} />
              <Text fw={700} style={{ whiteSpace: 'nowrap' }}>
                {metric.value}
              </Text>
            </Group>
            <Text size="xs" c="dimmed" lineClamp={2}>
              {metric.label}
            </Text>
          </div>
        ))}
      </SimpleGrid>
    </Paper>
  )
}
