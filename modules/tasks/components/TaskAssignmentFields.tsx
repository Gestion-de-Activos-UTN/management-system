import { Select, SimpleGrid } from '@mantine/core'
import { roleSlugLabel } from '@/lib/role-labels'
import { MemberSelect } from '@/modules/users/components/MemberSelect'
import type { TaskAssignmentOptions } from '../service'

export type TaskAssignmentKind = 'open_pool' | 'role' | 'user'

const ROLE_DISPLAY_ORDER: Record<string, number> = {
  org_admin: 0,
  office_manager: 1,
  org_viewer: 2,
}

const KIND_DESCRIPTIONS: Record<TaskAssignmentKind, string> = {
  open_pool: 'Cualquier persona elegible puede reclamarla',
  role: 'Sólo quienes tengan el rol elegido pueden reclamarla',
  user: 'Queda asignada a una persona concreta',
}

// Compartido por crear (TaskForm) y reasignar (TaskDetail): mismo vocabulario y mismas opciones.
export function TaskAssignmentFields({
  kind,
  target,
  options,
  targetError,
  disabled = false,
  loading = false,
  scopeReady = true,
  onKindChange,
  onTargetChange,
}: {
  kind: TaskAssignmentKind
  target: string | null
  options?: TaskAssignmentOptions
  targetError?: string
  disabled?: boolean
  loading?: boolean
  scopeReady?: boolean
  onKindChange: (kind: TaskAssignmentKind) => void
  onTargetChange: (target: string | null) => void
}) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }}>
      <Select
        label="Asignación"
        inputWrapperOrder={['label', 'input', 'description', 'error']}
        disabled={disabled}
        description={KIND_DESCRIPTIONS[kind]}
        data={[
          { value: 'open_pool', label: 'Pool abierto' },
          { value: 'role', label: 'Rol' },
          { value: 'user', label: 'Persona' },
        ]}
        value={kind}
        onChange={value => onKindChange((value ?? 'open_pool') as TaskAssignmentKind)}
      />
      {kind === 'role' && (
        <Select
          label="Rol asignado"
          inputWrapperOrder={['label', 'input', 'description', 'error']}
          disabled={disabled || loading || !scopeReady || !options?.roles.length}
          placeholder="Selecciona un rol"
          description={
            !scopeReady
              ? 'Selecciona primero las oficinas o la entidad relacionada.'
              : loading
                ? 'Cargando roles elegibles…'
                : options && !options.roles.length
                  ? 'No hay roles con personas elegibles para este alcance y entidad. Revisa la selección.'
                  : 'Roles con personas elegibles en cada oficina seleccionada.'
          }
          required
          data={[...(options?.roles ?? [])]
            .sort(
              (left, right) =>
                (ROLE_DISPLAY_ORDER[left.slug] ?? Infinity) -
                (ROLE_DISPLAY_ORDER[right.slug] ?? Infinity)
            )
            .map(role => ({
              value: role.id,
              label: roleSlugLabel(role.slug),
            }))}
          value={target}
          onChange={onTargetChange}
          error={targetError}
        />
      )}
      {kind === 'user' && (
        <MemberSelect
          label="Persona asignada"
          inputWrapperOrder={['label', 'input', 'description', 'error']}
          disabled={disabled || loading || !scopeReady || !options?.users.length}
          placeholder="Selecciona una persona"
          description={
            !scopeReady
              ? 'Selecciona primero las oficinas o la entidad relacionada.'
              : loading
                ? 'Cargando personas elegibles…'
                : options && !options.users.length
                  ? 'No hay personas elegibles para este alcance y entidad. Revisa la selección.'
                  : 'Personas con acceso a todas las oficinas y a la entidad.'
          }
          required
          members={options?.users ?? []}
          value={target}
          onChange={onTargetChange}
          error={targetError}
        />
      )}
    </SimpleGrid>
  )
}
