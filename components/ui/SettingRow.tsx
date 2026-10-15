import type { ReactNode } from 'react'
import { Group, Paper, Stack, Text } from '@mantine/core'

/**
 * Fila de ajuste binario dentro de un formulario: qué es y qué implica a la izquierda, el
 * control (Switch o SegmentedControl) a la derecha. Si el control no entra, baja debajo del
 * texto. `labelId` permite que el control se nombre con `aria-labelledby`.
 */
export function SettingRow({
  label,
  description,
  labelId,
  children,
}: {
  label: string
  description?: ReactNode
  labelId?: string
  children: ReactNode
}) {
  return (
    <Paper withBorder radius="md" px="md" py="sm">
      <Group justify="space-between" align="center" gap="md">
        <Stack gap={2} style={{ flex: '1 1 220px', minWidth: 0 }}>
          <Text id={labelId} size="sm" fw={600}>
            {label}
          </Text>
          {description && (
            <Text size="xs" c="dimmed">
              {description}
            </Text>
          )}
        </Stack>
        {children}
      </Group>
    </Paper>
  )
}
