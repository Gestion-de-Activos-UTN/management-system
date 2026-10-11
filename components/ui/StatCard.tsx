import type { ReactNode } from 'react'
import { Card, Stack, Text } from '@mantine/core'

/** Métrica suelta (icono, valor, etiqueta) para las grillas de resumen de las pantallas de detalle. */
export function StatCard({
  icon,
  value,
  label,
}: {
  icon: ReactNode
  value: ReactNode
  label: string
}) {
  return (
    <Card withBorder padding="lg">
      <Stack gap="sm">
        {icon}
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text size="xl" fw={700}>
            {value}
          </Text>
          <Text size="sm" c="dimmed">
            {label}
          </Text>
        </Stack>
      </Stack>
    </Card>
  )
}
