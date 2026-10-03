'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  Tabs,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { Inbox, ListTodo, Plus, Search, UserRound } from 'lucide-react'
import { DataTable } from '@/components/ui/DataTable'
import { FilterBar } from '@/components/ui/FilterBar'
import { PageHeader } from '@/components/ui/PageHeader'
import { useUiStore } from '@/lib/ui-store'
import { TaskForm } from '@/modules/tasks/components/TaskForm'
import { useTasks } from '@/modules/tasks/hooks/use-tasks'
import { getTasksColumns } from '@/modules/tasks/tasks.columns'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'

type TaskView = 'mine' | 'pool' | 'all'

const ALL = 'all'

const ALL_STATUSES = [
  { value: ALL, label: 'Todos los estados' },
  { value: 'planned', label: 'Planificadas' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'in_progress', label: 'En progreso' },
  { value: 'completed', label: 'Completadas' },
  { value: 'cancelled', label: 'Canceladas' },
]

// El pool sólo contiene tareas pendientes sin reclamar (ver endpoints/tasks.ts, view === 'pool').
const STATUS_OPTIONS: Record<TaskView, typeof ALL_STATUSES> = {
  mine: ALL_STATUSES,
  pool: [
    { value: ALL, label: 'Todos los estados' },
    { value: 'pending', label: 'Disponibles ahora' },
    { value: 'planned', label: 'Próximas' },
  ],
  all: ALL_STATUSES,
}

const EMPTY_LABELS: Record<TaskView, string> = {
  mine: 'No tienes tareas asignadas ni reclamadas con estos filtros',
  pool: 'No hay tareas disponibles para reclamar',
  all: 'No hay tareas con estos filtros',
}

export default function TasksPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const officeId = useUiStore(state => state.selectedOfficeId)
  const tenant = useTenantContext(asOrganization)
  const canCreate = tenant.data?.permissions.tasks.includes('create') ?? false
  const canManage = tenant.data?.permissions.tasks.includes('assign') ?? false
  const [view, setView] = useState<TaskView>('mine')
  const [status, setStatus] = useState<string | undefined>()
  const [priority, setPriority] = useState<string | undefined>()
  const [includeArchived, setIncludeArchived] = useState(false)
  const [opened, setOpened] = useState(false)
  const [search, setSearch] = useState('')
  const statusOptions = STATUS_OPTIONS[view]
  // Sólo las terminales se archivan: el toggle sobra cuando el filtro no puede devolverlas.
  const showArchivedToggle =
    view !== 'pool' && (!status || status === 'completed' || status === 'cancelled')
  const tasks = useTasks({
    view,
    status,
    priority,
    officeId,
    includeArchived: showArchivedToggle && includeArchived,
    asOrganization,
  })
  const changeView = (next: TaskView) => {
    setView(next)
    if (status && !STATUS_OPTIONS[next].some(option => option.value === status)) {
      setStatus(undefined)
    }
  }
  const visibleTasks = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return tasks.data ?? []
    return (tasks.data ?? []).filter(task =>
      [task.title, task.related_entity_info?.label].some(text => text?.toLowerCase().includes(term))
    )
  }, [tasks.data, search])
  const columns = useMemo(() => getTasksColumns(asOrganization), [asOrganization])

  return (
    <Stack gap="md">
      <PageHeader
        title="Tareas"
        description="Organiza, delega y sigue el trabajo de tu organización."
        rightSection={
          canCreate ? (
            <Button
              leftSection={<Plus size={16} strokeWidth={1.5} />}
              onClick={() => setOpened(true)}
            >
              Nueva tarea
            </Button>
          ) : undefined
        }
      />
      <Tabs value={view} onChange={value => changeView((value ?? 'mine') as TaskView)}>
        <Tabs.List>
          <Tabs.Tab value="mine" leftSection={<UserRound size={16} strokeWidth={1.5} />}>
            Mis tareas
          </Tabs.Tab>
          <Tabs.Tab value="pool" leftSection={<Inbox size={16} strokeWidth={1.5} />}>
            Pool disponible
          </Tabs.Tab>
          {canManage && (
            <Tabs.Tab value="all" leftSection={<ListTodo size={16} strokeWidth={1.5} />}>
              Todas
            </Tabs.Tab>
          )}
        </Tabs.List>
      </Tabs>
      <FilterBar>
        <TextInput
          placeholder="Buscar tarea o entidad..."
          aria-label="Buscar"
          leftSection={<Search size={16} strokeWidth={1.5} />}
          value={search}
          onChange={event => setSearch(event.currentTarget.value)}
          w="100%"
        />
        <Select
          placeholder="Estado"
          aria-label="Estado"
          data={statusOptions}
          value={status ?? ALL}
          onChange={value => setStatus(!value || value === ALL ? undefined : value)}
          w="100%"
        />
        <Select
          placeholder="Prioridad"
          aria-label="Prioridad"
          data={[
            { value: ALL, label: 'Todas las prioridades' },
            { value: 'urgent', label: 'Urgente' },
            { value: 'high', label: 'Alta' },
            { value: 'normal', label: 'Normal' },
            { value: 'low', label: 'Baja' },
          ]}
          value={priority ?? ALL}
          onChange={value => setPriority(!value || value === ALL ? undefined : value)}
          w="100%"
        />
        {showArchivedToggle && (
          <Group h={36}>
            <Tooltip label="Las tareas completadas o canceladas se archivan para despejar la lista">
              <Switch
                label="Incluir archivadas"
                checked={includeArchived}
                onChange={event => setIncludeArchived(event.currentTarget.checked)}
              />
            </Tooltip>
          </Group>
        )}
      </FilterBar>
      <DataTable
        columns={columns}
        data={visibleTasks}
        isLoading={tasks.isPending}
        emptyLabel={EMPTY_LABELS[view]}
        minWidth={850}
      />
      <Modal opened={opened} onClose={() => setOpened(false)} title="Nueva tarea" size="xl">
        <TaskForm asOrganization={asOrganization} onSaved={() => setOpened(false)} />
      </Modal>
    </Stack>
  )
}
