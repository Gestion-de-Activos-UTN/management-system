import type { ReactNode } from 'react'
import { Group, Paper, SimpleGrid, Skeleton, Text } from '@mantine/core'
import type { LucideIcon } from 'lucide-react'

export type StripMetric = { key: string; icon: LucideIcon; value: ReactNode; label: string }

/**
 * Contexto de infraestructura del panel general: cifras compactas debajo del bloque de riesgo,
 * informan sin competir con él. 4 columnas en anchos medianos, 2 en pantallas angostas.
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
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md" verticalSpacing="sm">
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
