import { Group, Stack, Text } from '@mantine/core'
import { formatDateTime, formatRelativeDays } from '@/lib/format-date'

/**
 * Celda de fecha de un evento: fecha y hora, y debajo cuánto hace ("hace 3 días"). Con `title`
 * (nombre propio del registro) el nombre va primero y la fecha queda al lado, más chica: la fila
 * mantiene dos líneas, con o sin nombre.
 */
export function DateTimeCell({
  value,
  title,
}: {
  value: string | null | undefined
  title?: string | null
}) {
  if (!value) {
    return (
      <Text size="sm" c="dimmed">
        —
      </Text>
    )
  }
  return (
    <Stack gap={0}>
      {title ? (
        <Group gap={8} align="baseline" wrap="wrap" style={{ rowGap: 0 }}>
          <Text size="sm" fw={600}>
            {title}
          </Text>
          <Text size="xs" c="dimmed">
            {formatDateTime(value)}
          </Text>
        </Group>
      ) : (
        <Text size="sm">{formatDateTime(value)}</Text>
      )}
      <Text size="xs" c="dimmed">
        {formatRelativeDays(value)}
      </Text>
    </Stack>
  )
}
