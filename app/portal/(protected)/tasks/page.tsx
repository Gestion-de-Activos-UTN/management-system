'use client'

import { matchesSearch } from '@/lib/search-text'
import { userFacingErrorMessage } from '@/lib/user-facing-error'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Alert,
  Button,
  Modal,
  Stack,
  SegmentedControl,
  Tabs,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { Inbox, ListTodo, Plus, Search, UserRound } from 'lucide-react'
import { DataTable } from '@/components/ui/DataTable'
import { FilterBar } from '@/components/ui/FilterBar'
import { MultiFilterSelect } from '@/components/ui/MultiFilterSelect'
import { PageHeader } from '@/components/ui/PageHeader'
import { useUiStore } from '@/lib/ui-store'
import { TaskForm } from '@/modules/tasks/components/TaskForm'
import { useTasks } from '@/modules/tasks/hooks/use-tasks'
import { getTasksColumns } from '@/modules/tasks/tasks.columns'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'

type TaskView = 'mine' | 'pool' | 'all'

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgente' },
  { value: 'high', label: 'Alta' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Baja' },
]

// Sólo estados reales y de selección múltiple: "lo que falta hacer" es marcar varios, no una
// categoría aparte que haga parecer que una tarea tiene dos estados a la vez.
const ALL_STATUSES = [
  { value: 'planned', label: 'Planificadas' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'in_progress', label: 'En progreso' },
  { value: 'completed', label: 'Completadas' },
  { value: 'cancelled', label: 'Canceladas' },
]

// El pool sólo contiene tareas pendientes sin reclamar (ver endpoints/tasks.ts, view === 'pool'):
// ahí el estado es binario (se puede reclamar ya o todavía no) y va como SegmentedControl.
// Textos cortos: tres segmentos iguales en una columna de FilterBar.
const POOL_STATUS_OPTIONS = [
  { value: 'all', label: 'Todas' },
  { value: 'pending', label: 'Ahora' },
  { value: 'planned', label: 'Próximas' },
]

// Estados con los que abre cada pestaña (vacío = todos): lo propio que falta hacer, lo que se
// puede reclamar ya, y en "Todas" ningún filtro (vista de supervisión completa).
const DEFAULT_STATUS: Record<TaskView, string[]> = {
  mine: ['planned', 'pending', 'in_progress'],
  pool: ['pending'],
  all: [],
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
  const [status, setStatus] = useState<string[]>(DEFAULT_STATUS.mine)
  const [priority, setPriority] = useState<string[]>([])
  const [includeArchived, setIncludeArchived] = useState(false)
  const [opened, setOpened] = useState(false)
  const [search, setSearch] = useState('')
  // Sólo las terminales se archivan: el toggle sobra cuando el filtro no puede devolverlas.
  const showArchivedToggle =
    view !== 'pool' &&
    (!status.length || status.some(value => value === 'completed' || value === 'cancelled'))
  const tasks = useTasks({
    view,
    status,
    priority,
    officeId,
    includeArchived: showArchivedToggle && includeArchived,
    asOrganization,
  })
  const changeView = (next: TaskView) => {
    // Cada pestaña abre con sus filtros por defecto (el estado cambia de opciones entre vistas);
    // la búsqueda escrita se conserva.
    setView(next)
    setStatus(DEFAULT_STATUS[next])
    setPriority([])
    setIncludeArchived(false)
  }
  const visibleTasks = useMemo(() => {
    const term = search.trim()
    if (!term) return tasks.data ?? []
    return (tasks.data ?? []).filter(task =>
      matchesSearch([task.title, task.related_entity_info?.label], term)
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
      <Stack key={view} gap="md" className="tab-panel-enter">
        <FilterBar>
          <TextInput
            placeholder="Buscar tarea o entidad..."
            aria-label="Buscar"
            leftSection={<Search size={16} strokeWidth={1.5} />}
            value={search}
            onChange={event => setSearch(event.currentTarget.value)}
            w="100%"
          />
          {view !== 'pool' && (
            <MultiFilterSelect
              ariaLabel="Estado"
              allLabel="Todos los estados"
              data={ALL_STATUSES}
              value={status}
              onChange={setStatus}
            />
          )}
          <MultiFilterSelect
            ariaLabel="Prioridad"
            allLabel="Todas las prioridades"
            data={PRIORITY_OPTIONS}
            value={priority}
            onChange={setPriority}
          />
          {view === 'pool' && (
            <Tooltip label="Disponibilidad">
              <SegmentedControl
                aria-label="Disponibilidad"
                fullWidth
                data={POOL_STATUS_OPTIONS}
                value={status[0] ?? 'all'}
                onChange={value => setStatus(value === 'all' ? [] : [value])}
              />
            </Tooltip>
          )}
          {showArchivedToggle && (
            <Tooltip label="Las tareas completadas o canceladas se archivan para despejar la lista">
              <SegmentedControl
                aria-label="Tareas archivadas"
                fullWidth
                data={[
                  { value: 'hide', label: 'Sin archivar' },
                  { value: 'include', label: 'Todas' },
                ]}
                value={includeArchived ? 'include' : 'hide'}
                onChange={value => setIncludeArchived(value === 'include')}
              />
            </Tooltip>
          )}
        </FilterBar>
        {officeId && (
          <Text size="xs" c="dimmed">
            Incluye tareas de la oficina seleccionada y de toda la organización.
          </Text>
        )}
        {tasks.isError && (
          <Alert color="red" title="No se pudieron cargar las tareas">
            <Stack gap="xs" align="flex-start">
              <Text size="sm">
                {userFacingErrorMessage(tasks.error, 'Intenta cargar la lista nuevamente.')}
              </Text>
              <Button variant="light" size="xs" onClick={() => void tasks.refetch()}>
                Reintentar
              </Button>
            </Stack>
          </Alert>
        )}
        {!tasks.isError && (
          <DataTable
            columns={columns}
            data={visibleTasks}
            isLoading={tasks.isPending}
            emptyLabel={EMPTY_LABELS[view]}
            minWidth={850}
          />
        )}
      </Stack>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Nueva tarea"
        size="xl"
        centered
      >
        <TaskForm asOrganization={asOrganization} onSaved={() => setOpened(false)} />
      </Modal>
    </Stack>
  )
}
