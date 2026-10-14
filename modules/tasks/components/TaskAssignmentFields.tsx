import { Select, SimpleGrid } from '@mantine/core'
import { roleSlugLabel } from '@/lib/role-labels'
import { MemberSelect } from '@/modules/users/components/MemberSelect'
import type { TaskAssignmentOptions } from '../service'

export type TaskAssignmentKind = 'open_pool' | 'role' | 'user'

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
  onKindChange,
  onTargetChange,
}: {
  kind: TaskAssignmentKind
  target: string | null
  options?: TaskAssignmentOptions
  targetError?: string
  onKindChange: (kind: TaskAssignmentKind) => void
  onTargetChange: (target: string | null) => void
}) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }}>
      <Select
        label="Asignación"
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
          description="Roles con acceso a la oficina y a la entidad"
          required
          data={(options?.roles ?? []).map(role => ({
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
          description="Personas con acceso a la oficina y a la entidad"
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
