import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { CircleCheck, ChevronRight } from 'lucide-react'
import { Card, Group, Skeleton, Stack, Text, ThemeIcon, UnstyledButton } from '@mantine/core'
import { StatusBadge } from '@/components/ui/StatusBadge'

export type AttentionItem = {
  key: string
  label: string
  description: string
  count: number
  href: string
  icon: LucideIcon
  color: string
}

/** Pendientes accionables: sólo muestra los que tienen algo, cada uno lleva a donde se resuelve. */
export function AttentionCard({
  items,
  isPending,
}: {
  items: AttentionItem[]
  isPending: boolean
}) {
  const pending = items.filter(item => item.count > 0)
  return (
    <Card withBorder radius="lg" p="lg">
      <Stack gap="md">
        <Group justify="space-between">
          <Text fw={700}>Requiere atención</Text>
          {!isPending && pending.length > 0 && (
            <StatusBadge
              tone="danger"
              label={`${pending.length} ${pending.length === 1 ? 'tema' : 'temas'}`}
            />
          )}
        </Group>
        {isPending ? (
          <Stack gap="sm">
            <Skeleton height={44} />
            <Skeleton height={44} />
            <Skeleton height={44} />
          </Stack>
        ) : pending.length === 0 ? (
          <Group gap="sm" wrap="nowrap" align="flex-start">
            <ThemeIcon color="pine" variant="light" size="lg" radius="xl" style={{ flexShrink: 0 }}>
              <CircleCheck size={18} strokeWidth={1.5} />
            </ThemeIcon>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text size="sm" fw={600}>
                Sin pendientes detectados
              </Text>
              <Text size="sm" c="dimmed">
                Aquí aparecerán los equipos, revisiones y tareas que necesiten atención.
              </Text>
            </div>
          </Group>
        ) : (
          <Stack gap={4}>
            {pending.map(item => (
              <UnstyledButton
                key={item.key}
                component={Link}
                href={item.href}
                p="xs"
                style={{ borderRadius: 'var(--mantine-radius-md)' }}
                className="attention-row"
              >
                <Group gap="sm" wrap="nowrap">
                  <ThemeIcon color={item.color} variant="light" size="lg" radius="md">
                    <item.icon size={18} strokeWidth={1.5} />
                  </ThemeIcon>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text size="sm" fw={600}>
                      {item.count} {item.label}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {item.description}
                    </Text>
                  </div>
                  <ChevronRight size={16} strokeWidth={1.5} />
                </Group>
              </UnstyledButton>
            ))}
          </Stack>
        )}
      </Stack>
    </Card>
  )
}
