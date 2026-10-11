import { Fragment, type ReactNode } from 'react'
import { Divider, Group, Paper, SimpleGrid, Skeleton, Text } from '@mantine/core'
import type { LucideIcon } from 'lucide-react'

export type StripMetric = { key: string; icon: LucideIcon; value: ReactNode; label: string }

/**
 * Contexto de infraestructura del panel general en una franja de una línea: informa sin competir
 * con el bloque de riesgo. En pantallas angostas pasa a una grilla de 2 columnas.
 */
export function MetricsStrip({
  metrics,
  isPending,
}: {
  metrics: StripMetric[]
  isPending: boolean
}) {
  if (isPending) return <Skeleton height={52} radius="md" />
  const item = (metric: StripMetric) => (
    <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
      <metric.icon size={16} strokeWidth={1.5} style={{ flexShrink: 0, opacity: 0.7 }} />
      <Text size="sm" fw={700} style={{ whiteSpace: 'nowrap' }}>
        {metric.value}
      </Text>
      <Text size="sm" c="dimmed" truncate>
        {metric.label}
      </Text>
    </Group>
  )
  return (
    <Paper withBorder radius="lg" px="md" py="sm">
      <Group gap="md" justify="space-between" wrap="nowrap" visibleFrom="md">
        {metrics.map((metric, index) => (
          <Fragment key={metric.key}>
            {index > 0 && <Divider orientation="vertical" />}
            {item(metric)}
          </Fragment>
        ))}
      </Group>
      <SimpleGrid cols={2} spacing="sm" hiddenFrom="md">
        {metrics.map(metric => (
          <Fragment key={metric.key}>{item(metric)}</Fragment>
        ))}
      </SimpleGrid>
    </Paper>
  )
}
