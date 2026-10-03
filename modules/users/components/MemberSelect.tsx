import { Select, type SelectProps } from '@mantine/core'
import { orgMemberOptionLabel, type OrgMember } from '../service'

type MemberOption = Pick<OrgMember, 'id' | 'name' | 'email'> & { role: string }

/**
 * Selector único de personas (responsable, usuario asignado, etc.). Quien lo usa decide qué
 * miembros son elegibles; este componente sólo fija cómo se buscan y se muestran.
 * `emptyOption` agrega una opción explícita de "sin asignar" con su propio valor centinela.
 */
export function MemberSelect({
  members,
  emptyOption,
  ...props
}: Omit<SelectProps, 'data'> & {
  members: MemberOption[]
  emptyOption?: { value: string; label: string }
}) {
  return (
    <Select
      searchable
      nothingFoundMessage="Ninguna persona coincide"
      {...props}
      data={[
        ...(emptyOption ? [emptyOption] : []),
        ...members.map(member => ({ value: member.id, label: orgMemberOptionLabel(member) })),
      ]}
    />
  )
}
