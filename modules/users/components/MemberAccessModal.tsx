'use client'

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
}: {
  member: OrgMember | null
  isSelf: boolean
  /** Oficinas activas de la organización. */
  officeOptions: OfficeOption[]
  onClose: () => void
  asOrganization?: string
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
}: {
  member: OrgMember
  isSelf: boolean
  officeOptions: OfficeOption[]
  onDone: () => void
  asOrganization?: string
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

  const submit = () => {
    setError('')
    if (needsOffices && !officeIds.length) {
      setError('Asigna al menos una oficina.')
      return
    }
    update.mutate(
      {
        userId: member.id,
        input: { role, ...(needsOffices ? { office_ids: officeIds } : {}) },
        message: `Se actualizó el acceso de ${member.name || member.email}.`,
      },
      { onSuccess: onDone }
    )
  }

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        {member.name || member.email}
        {member.name && ` · ${member.email}`}
      </Text>
      <Radio.Group
        label="Rol"
        value={role}
        onChange={value => setRole(value as OrganizationRoleSlug)}
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
          description="Sólo verá y gestionará la información de estas oficinas."
          placeholder={officeIds.length ? undefined : 'Selecciona una o más oficinas'}
          searchable
          data={officeOptions}
          value={officeIds}
          onChange={setOfficeIds}
          comboboxProps={{ withinPortal: true }}
        />
      ) : (
        <Text size="sm" c="dimmed">
          Un administrador cubre siempre todas las oficinas de la organización.
        </Text>
      )}
      {error && <Alert color="red">{error}</Alert>}
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
    </Stack>
  )
}
