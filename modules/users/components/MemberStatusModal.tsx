'use client'

import { useState } from 'react'
import { Alert, Button, Group, Modal, MultiSelect, Stack, Text } from '@mantine/core'
import { UserCheck, UserX } from 'lucide-react'
import type { OrgMember } from '../service'
import { useUpdateOrgMember } from '../hooks/use-org-members'

type OfficeOption = { value: string; label: string }

/** Confirmación para desactivar o reactivar a una persona. */
export function MemberStatusModal({
  member,
  officeOptions,
  onClose,
  asOrganization,
}: {
  member: OrgMember | null
  /** Oficinas activas de la organización. */
  officeOptions: OfficeOption[]
  onClose: () => void
  asOrganization?: string
}) {
  return (
    <Modal
      opened={Boolean(member)}
      onClose={onClose}
      title={member?.is_active ? 'Desactivar persona' : 'Reactivar persona'}
      centered
    >
      {member && (
        <MemberStatusForm
          key={member.id}
          member={member}
          officeOptions={officeOptions}
          onDone={onClose}
          asOrganization={asOrganization}
        />
      )}
    </Modal>
  )
}

function MemberStatusForm({
  member,
  officeOptions,
  onDone,
  asOrganization,
}: {
  member: OrgMember
  officeOptions: OfficeOption[]
  onDone: () => void
  asOrganization?: string
}) {
  const update = useUpdateOrgMember(asOrganization)
  const name = member.name || member.email
  const deactivating = member.is_active
  const activeOfficeIds = new Set(officeOptions.map(option => option.value))
  const keptOffices = member.office_ids.filter(id => activeOfficeIds.has(id))
  // Al reactivar, quien no es administrador necesita al menos una oficina activa: si las suyas
  // se desactivaron mientras tanto, se le asignan acá.
  const needsOffices = !deactivating && member.role !== 'org_admin' && !keptOffices.length
  const [officeIds, setOfficeIds] = useState<string[]>([])

  const confirm = () =>
    update.mutate(
      {
        userId: member.id,
        input: { is_active: !deactivating, ...(needsOffices ? { office_ids: officeIds } : {}) },
        message: deactivating ? `${name} quedó desactivada.` : `${name} quedó reactivada.`,
      },
      { onSuccess: onDone }
    )

  return (
    <Stack gap="md">
      {deactivating ? (
        <Text size="sm">
          <strong>{name}</strong> pierde el acceso de inmediato y se cierran sus sesiones abiertas.
          Su historial se conserva y puedes reactivarla más adelante.
        </Text>
      ) : (
        <Text size="sm">
          <strong>{name}</strong> vuelve a tener acceso con su rol anterior.
        </Text>
      )}
      {needsOffices && (
        <>
          <Alert color="yellow">
            Sus oficinas ya no están activas. Asígnale al menos una para reactivarla.
          </Alert>
          <MultiSelect
            label="Oficinas"
            placeholder="Selecciona una o más oficinas"
            searchable
            data={officeOptions}
            value={officeIds}
            onChange={setOfficeIds}
            comboboxProps={{ withinPortal: true }}
          />
        </>
      )}
      <Group justify="flex-end" gap="xs">
        <Button variant="default" onClick={onDone}>
          Cancelar
        </Button>
        <Button
          color={deactivating ? 'red' : undefined}
          loading={update.isPending}
          disabled={needsOffices && !officeIds.length}
          leftSection={
            deactivating ? (
              <UserX size={16} strokeWidth={1.5} />
            ) : (
              <UserCheck size={16} strokeWidth={1.5} />
            )
          }
          onClick={confirm}
        >
          {deactivating ? 'Desactivar' : 'Reactivar'}
        </Button>
      </Group>
    </Stack>
  )
}
