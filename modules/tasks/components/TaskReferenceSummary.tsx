import Link from 'next/link'
import { Button, Group, Paper, Text, ThemeIcon } from '@mantine/core'
import { ExternalLink } from 'lucide-react'
import { TASK_REFERENCE_ICONS, TASK_REFERENCE_TYPE_LABELS } from '../task-labels'

export function TaskReferenceSummary({
  relationTo,
  label,
  href,
}: {
  relationTo: string
  label: string | null
  href?: string | null
}) {
  const Icon = TASK_REFERENCE_ICONS[relationTo]
  return (
    <Paper withBorder radius="md" p="sm">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap="sm" wrap="nowrap" miw={0}>
          <ThemeIcon variant="light" size="lg" radius="md">
            {Icon && <Icon size={18} strokeWidth={1.5} />}
          </ThemeIcon>
          <div style={{ minWidth: 0 }}>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              {TASK_REFERENCE_TYPE_LABELS[relationTo] ?? relationTo}
            </Text>
            <Text fw={600} size="sm" lineClamp={2} c={label ? undefined : 'dimmed'}>
              {label ?? 'Entidad no disponible o sin acceso'}
            </Text>
          </div>
        </Group>
        {href && (
          <Button
            component={Link}
            href={href}
            variant="light"
            size="xs"
            rightSection={<ExternalLink size={14} strokeWidth={1.5} />}
          >
            Abrir
          </Button>
        )}
      </Group>
    </Paper>
  )
}
