'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button, Checkbox, Modal, Select, SimpleGrid, Stack, Tabs } from '@mantine/core'
import { Plus } from 'lucide-react'
import { DataTable } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { useUiStore } from '@/lib/ui-store'
import { TaskForm } from '@/modules/tasks/components/TaskForm'
import { useTasks } from '@/modules/tasks/hooks/use-tasks'
import { getTasksColumns } from '@/modules/tasks/tasks.columns'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'

export default function TasksPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const officeId = useUiStore(state => state.selectedOfficeId)
  const tenant = useTenantContext(asOrganization)
  const canCreate = tenant.data?.permissions.tasks.includes('create') ?? false
  const canManage = tenant.data?.permissions.tasks.includes('assign') ?? false
  const [view, setView] = useState<'mine' | 'pool' | 'all'>('mine')
  const [status, setStatus] = useState<string | undefined>()
  const [priority, setPriority] = useState<string | undefined>()
  const [includeArchived, setIncludeArchived] = useState(false)
  const [opened, setOpened] = useState(false)
  const tasks = useTasks({ view, status, priority, officeId, includeArchived, asOrganization })
  const columns = useMemo(() => getTasksColumns(asOrganization), [asOrganization])

  return (
    <Stack gap="md">
      <PageHeader
        title="Tareas"
        description="Organiza, delega y sigue el trabajo de tu organización."
        rightSection={
          canCreate ? (
            <Button leftSection={<Plus size={16} />} onClick={() => setOpened(true)}>
              Nueva tarea
            </Button>
          ) : undefined
        }
      />
      <Tabs value={view} onChange={value => setView((value ?? 'mine') as typeof view)}>
        <Tabs.List>
          <Tabs.Tab value="mine">Mis tareas</Tabs.Tab>
          <Tabs.Tab value="pool">Pool disponible</Tabs.Tab>
          {canManage && <Tabs.Tab value="all">Todas</Tabs.Tab>}
        </Tabs.List>
      </Tabs>
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Select
          clearable
          placeholder="Todos los estados"
          data={[
            { value: 'planned', label: 'Planificada' },
            { value: 'pending', label: 'Pendiente' },
            { value: 'in_progress', label: 'En progreso' },
            { value: 'completed', label: 'Completada' },
            { value: 'cancelled', label: 'Cancelada' },
          ]}
          value={status ?? null}
          onChange={value => setStatus(value ?? undefined)}
        />
        <Select
          clearable
          placeholder="Todas las prioridades"
          data={[
            { value: 'low', label: 'Baja' },
            { value: 'normal', label: 'Normal' },
            { value: 'high', label: 'Alta' },
            { value: 'urgent', label: 'Urgente' },
          ]}
          value={priority ?? null}
          onChange={value => setPriority(value ?? undefined)}
        />
        <Checkbox
          label="Mostrar archivadas"
          checked={includeArchived}
          onChange={event => setIncludeArchived(event.currentTarget.checked)}
          mt="xs"
        />
      </SimpleGrid>
      <DataTable
        columns={columns}
        data={tasks.data ?? []}
        isLoading={tasks.isPending}
        emptyLabel="No hay tareas para esta vista"
        minWidth={850}
      />
      <Modal opened={opened} onClose={() => setOpened(false)} title="Nueva tarea" size="xl">
        <TaskForm asOrganization={asOrganization} onSaved={() => setOpened(false)} />
      </Modal>
    </Stack>
  )
}
