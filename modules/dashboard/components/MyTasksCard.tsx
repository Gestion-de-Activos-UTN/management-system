import Link from 'next/link'
import { Anchor, Card, Group, Skeleton, Stack, Text } from '@mantine/core'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatRelativeDays } from '@/lib/format-date'
import type { TaskDTO } from '@/modules/tasks/service'
import { TASK_STATUS_LABELS, TASK_STATUS_TONES } from '@/modules/tasks/task-labels'

const VISIBLE = 5

/** Próximas tareas abiertas del usuario, primero las que vencen antes. */
export function MyTasksCard({
  tasks,
  isPending,
  tasksHref,
  taskHref,
}: {
  tasks: TaskDTO[]
  isPending: boolean
  tasksHref: string
  taskHref: (id: string) => string
}) {
  const open = tasks
    .filter(task => task.effective_status !== 'completed' && task.effective_status !== 'cancelled')
    .sort((a, b) => Date.parse(a.due_at ?? '9999') - Date.parse(b.due_at ?? '9999'))
  return (
    <Card withBorder radius="lg" p="lg" h="100%">
      <Stack gap="md">
        <Group justify="space-between">
          <Text fw={700}>Mis tareas</Text>
          <Anchor component={Link} href={tasksHref} size="sm">
            Ver todas{open.length > VISIBLE ? ` (${open.length})` : ''}
          </Anchor>
        </Group>
        {isPending ? (
          <Stack gap="sm">
            <Skeleton height={40} />
            <Skeleton height={40} />
          </Stack>
        ) : open.length === 0 ? (
          <Text size="sm" c="dimmed" py="md">
            No tienes tareas abiertas. Las que reclames o te asignen aparecerán acá.
          </Text>
        ) : (
          <Stack gap="xs">
            {open.slice(0, VISIBLE).map(task => (
              <Group key={task.id} justify="space-between" wrap="nowrap" gap="sm">
                <div style={{ minWidth: 0 }}>
                  <Anchor component={Link} href={taskHref(task.id)} size="sm" fw={600} c="inherit">
                    <Text span inherit lineClamp={1}>
                      {task.title}
                    </Text>
                  </Anchor>
                  <Text size="xs" c={task.is_overdue ? 'red' : 'dimmed'}>
                    {task.due_at
                      ? `${task.is_overdue ? 'Venció' : 'Vence'} ${formatRelativeDays(task.due_at)}`
                      : 'Sin vencimiento'}
                  </Text>
                </div>
                <div style={{ flexShrink: 0 }}>
                  <StatusBadge
                    tone={TASK_STATUS_TONES[task.effective_status]}
                    label={TASK_STATUS_LABELS[task.effective_status]}
                  />
                </div>
              </Group>
            ))}
          </Stack>
        )}
      </Stack>
    </Card>
  )
}
