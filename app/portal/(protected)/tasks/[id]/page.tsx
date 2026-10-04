'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { Center, Loader, Stack, Text } from '@mantine/core'
import { BackButton } from '@/components/ui/BackButton'
import { useTask } from '@/modules/tasks/hooks/use-tasks'
import { TaskDetail } from '@/modules/tasks/components/TaskDetail'

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const task = useTask(id, asOrganization)
  const suffix = asOrganization ? `?asOrganization=${asOrganization}` : ''
  if (task.isPending)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    )
  if (!task.data || task.isError) return <Text c="red">No se pudo cargar esta tarea.</Text>
  return (
    <Stack gap="md">
      <BackButton href={`/portal/tasks${suffix}`} label="Volver a tareas" />
      <TaskDetail task={task.data} asOrganization={asOrganization} />
    </Stack>
  )
}
