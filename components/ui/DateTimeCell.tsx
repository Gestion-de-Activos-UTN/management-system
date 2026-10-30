import { Stack } from '@mantine/core'
import { formatDateTime, formatRelativeDays } from '@/lib/format-date'
import { OneLineText } from './OneLineText'

/** Keep each title/date on one line; preserve the intentional secondary date information. */
export function DateTimeCell({
  value,
  title,
}: {
  value: string | null | undefined
  title?: string | null
}) {
  return (
    <Stack gap={0} miw={0}>
      {title && <OneLineText fw={600}>{title}</OneLineText>}
      <OneLineText size={title ? 'xs' : 'sm'} c={title || !value ? 'dimmed' : undefined}>
        {value ? formatDateTime(value) : '—'}
      </OneLineText>
      {value && (
        <OneLineText size="xs" c="dimmed">
          {formatRelativeDays(value)}
        </OneLineText>
      )}
    </Stack>
  )
}
