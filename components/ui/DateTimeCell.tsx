import { Stack, Text } from '@mantine/core'
import { formatDateTime, formatRelativeDays } from '@/lib/format-date'

/** Celda de fecha de un evento: fecha y hora, y debajo cuánto hace ("hace 3 días"). */
export function DateTimeCell({ value }: { value: string | null | undefined }) {
  if (!value) {
    return (
      <Text size="sm" c="dimmed">
        —
      </Text>
    )
  }
  return (
    <Stack gap={0}>
      <Text size="sm">{formatDateTime(value)}</Text>
      <Text size="xs" c="dimmed">
        {formatRelativeDays(value)}
      </Text>
    </Stack>
  )
}
