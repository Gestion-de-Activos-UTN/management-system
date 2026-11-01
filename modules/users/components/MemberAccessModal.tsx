'use client'

import { ModalLayout } from '@/components/ui/ModalLayout'
import { useState } from 'react'
import { Alert, Button, Group, Modal, MultiSelect, Radio, Stack, Text } from '@mantine/core'
import { Save, TriangleAlert } from 'lucide-react'
import { ROLE_LABELS } from '@/lib/role-labels'
import type { OrgMember } from '../service'
import { ORGANIZATION_ROLES, type OrganizationRoleSlug } from '../schema'
import { ROLE_DESCRIPTIONS } from '../member-labels'
import { useUpdateOrgMember } from '../hooks/use-org-members'

type OfficeOption = { value: string; label: string }

/** Cambia el rol y las oficinas de una persona. Lo que no se puede (escalar, dejar la
 * organización sin administrador) lo rechaza el servidor y se muestra acá. */
export function MemberAccessModal({
  member,
  isSelf,
  officeOptions,
  onClose,
  asOrganization,
  allowRoleChange = true,
}: {
  member: OrgMember | null
  isSelf: boolean
  /** Oficinas activas de la organización. */
  officeOptions: OfficeOption[]
  onClose: () => void
  asOrganization?: string
  allowRoleChange?: boolean
}) {
  return (
    <Modal opened={Boolean(member)} onClose={onClose} title="Editar acceso" centered size="lg">
      {member && (
        <MemberAccessForm
          key={member.id}
          member={member}
          isSelf={isSelf}
          officeOptions={officeOptions}
          onDone={onClose}
          asOrganization={asOrganization}
          allowRoleChange={allowRoleChange}
        />
      )}
    </Modal>
  )
}

function MemberAccessForm({
  member,
  isSelf,
  officeOptions,
  onDone,
  asOrganization,
  allowRoleChange,
}: {
  member: OrgMember
  isSelf: boolean
  officeOptions: OfficeOption[]
  onDone: () => void
  asOrganization?: string
  allowRoleChange: boolean
}) {
  const currentRole = member.role as OrganizationRoleSlug
  const [role, setRole] = useState<OrganizationRoleSlug>(currentRole)
  const activeOfficeIds = new Set(officeOptions.map(option => option.value))
  const [officeIds, setOfficeIds] = useState(
    member.office_ids.filter(id => activeOfficeIds.has(id))
  )
  const [error, setError] = useState('')
  const update = useUpdateOrgMember(asOrganization)
  // ORGANIZATION_ROLES va de mayor a menor autoridad: un índice mayor es un rol de menos peso.
  const losingAuthority = ORGANIZATION_ROLES.indexOf(role) > ORGANIZATION_ROLES.indexOf(currentRole)
  const needsOffices = role !== 'org_admin'
  const removedOffices =
    member.is_active && needsOffices
      ? member.office_ids.filter(id => activeOfficeIds.has(id) && !officeIds.includes(id))
      : []

  const submit = () => {
    setError('')
    if (needsOffices && !officeIds.length) {
      setError('Selecciona al menos una oficina.')
      return
    }
    update.mutate(
      {
        userId: member.id,
        input: {
          ...(allowRoleChange ? { role } : {}),
          ...(needsOffices ? { office_ids: officeIds } : {}),
        },
        message: `Se actualizó el acceso de ${member.name || member.email}.${member.is_active ? '' : ' La cuenta sigue inactiva.'}`,
      },
      { onSuccess: onDone }
    )
  }

  return (
    <ModalLayout
      gap="md"
      footer={
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onDone}>
            Cancelar
          </Button>
          <Button
            color={isSelf && losingAuthority ? 'yellow' : undefined}
            loading={update.isPending}
            leftSection={<Save size={16} strokeWidth={1.5} />}
            onClick={submit}
          >
            {isSelf && losingAuthority ? 'Bajar mi rol' : 'Guardar cambios'}
          </Button>
        </Group>
      }
    >
      <Text size="sm" c="dimmed">
        {member.name || member.email}
        {member.name && member.email && ` · ${member.email}`}
      </Text>
      {!member.is_active && (
        <Alert color="gray" title="La cuenta seguirá inactiva">
          Guardar actualiza su rol y oficinas sin reactivar la cuenta. Al reactivarla se comprobará
          el cupo disponible para el rol elegido.
        </Alert>
      )}
      {allowRoleChange ? (
        <Radio.Group
          label="Rol"
          withAsterisk
          value={role}
          onChange={value => {
            setRole(value as OrganizationRoleSlug)
            if (value === 'org_admin') setError('')
          }}
        >
          <Stack gap="xs" mt="xs">
            {ORGANIZATION_ROLES.map(slug => (
              <Radio.Card key={slug} value={slug} radius="md" p="sm" withBorder>
                <Group wrap="nowrap" align="flex-start" gap="sm">
                  <Radio.Indicator />
                  <div>
                    <Text size="sm" fw={600}>
                      {ROLE_LABELS[slug]}
                      {slug === currentRole && (
                        <Text span size="xs" c="dimmed" fw={400}>
                          {' '}
                          · rol actual
                        </Text>
                      )}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {ROLE_DESCRIPTIONS[slug]}
                    </Text>
                  </div>
                </Group>
              </Radio.Card>
            ))}
          </Stack>
        </Radio.Group>
      ) : (
        <Stack gap={2}>
          <Text size="sm" fw={500}>
            Rol
          </Text>
          <Text size="sm" c="dimmed">
            {ROLE_LABELS[currentRole]}
          </Text>
        </Stack>
      )}
      {isSelf && losingAuthority && (
        <Alert
          color="yellow"
          icon={<TriangleAlert size={16} strokeWidth={1.5} />}
          title="Vas a bajar tu propio rol"
        >
          Pasarás a {ROLE_LABELS[role]} y perderás los permisos de {ROLE_LABELS[currentRole]} apenas
          guardes. No podrás volver a subirte de rol: sólo otro administrador podrá hacerlo.
        </Alert>
      )}
      {needsOffices ? (
        <MultiSelect
          label="Oficinas"
          withAsterisk
          description={
            member.is_active
              ? 'Sólo verá y gestionará la información de estas oficinas.'
              : 'Estas oficinas se usarán cuando reactives a la persona.'
          }
          placeholder={officeIds.length ? undefined : 'Selecciona una o más oficinas'}
          searchable
          data={officeOptions}
          value={officeIds}
          onChange={value => {
            setOfficeIds(value)
            if (value.length) setError('')
          }}
          error={error}
          comboboxProps={{ withinPortal: true }}
        />
      ) : (
        <Text size="sm" c="dimmed">
          Un administrador cubre siempre todas las oficinas de la organización.
        </Text>
      )}
      {removedOffices.length > 0 && (
        <Alert color="yellow" title="Vas a quitar acceso a oficinas">
          Al quitar{' '}
          {removedOffices
            .map(id => officeOptions.find(option => option.value === id)?.label)
            .join(', ')}
          , los activos que tenga a cargo en esas oficinas quedarán sin responsable y las tareas que
          haya tomado allí volverán a pendientes. Los activos y las tareas de las oficinas que
          conserve no se modificarán.
        </Alert>
      )}
    </ModalLayout>
  )
}
