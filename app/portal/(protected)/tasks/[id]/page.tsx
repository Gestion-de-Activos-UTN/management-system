'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { Center, Loader, Stack } from '@mantine/core'
import { ResourceError } from '@/components/ui/ResourceError'
import { BackButton } from '@/components/ui/BackButton'
import { portalHref } from '@/lib/portal-href'
import { useTask } from '@/modules/tasks/hooks/use-tasks'
import { TaskDetail } from '@/modules/tasks/components/TaskDetail'

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const task = useTask(id, asOrganization)
  if (task.isPending)
    return (
      <Center py="xl">
        <Loader />
      </Center>
    )
  if (!task.data || task.isError)
    return (
      <ResourceError
        error={task.error}
        resource="esta tarea"
        backHref={portalHref('/portal/tasks', asOrganization)}
        backLabel="Volver a tareas"
        onRetry={() => void task.refetch()}
        retrying={task.isFetching}
      />
    )
  return (
    <Stack gap="md">
      <BackButton href={portalHref('/portal/tasks', asOrganization)} label="Volver a tareas" />
      <TaskDetail task={task.data} asOrganization={asOrganization} />
    </Stack>
  )
}
