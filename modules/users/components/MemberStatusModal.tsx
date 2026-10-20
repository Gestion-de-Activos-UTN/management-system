'use client'

import { useState } from 'react'
import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  MultiSelect,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { ClipboardList, Info, Package, UserCheck, UserX } from 'lucide-react'
import { MetricsStrip } from '@/components/ui/MetricsStrip'
import { memberCoversOffice, type OrgMember } from '../service'
import {
  useMemberDeactivationImpact,
  useOrgMembers,
  useUpdateOrgMember,
} from '../hooks/use-org-members'
import { MemberSelect } from './MemberSelect'

const NO_REPLACEMENT = '__no_replacement__'

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
  const [replacementId, setReplacementId] = useState<string | null>(null)
  const [confirmationEmail, setConfirmationEmail] = useState('')
  const impact = useMemberDeactivationImpact(deactivating ? member.id : null, asOrganization)
  const { data: members } = useOrgMembers(asOrganization)
  const ownedAssets = impact.data?.owned_assets ?? []
  // Sólo los activos de oficinas activas cambian de responsable; el reemplazo tiene que cubrirlas.
  const reassignableOffices = [
    ...new Set(ownedAssets.filter(asset => asset.office_active).map(asset => asset.office_id)),
  ]
  const candidates = (members ?? []).filter(
    candidate =>
      candidate.id !== member.id &&
      reassignableOffices.every(officeId => memberCoversOffice(candidate, officeId))
  )
  const emailMatches = confirmationEmail.trim().toLowerCase() === member.email.trim().toLowerCase()

  const confirm = () =>
    update.mutate(
      {
        userId: member.id,
        input: {
          is_active: !deactivating,
          ...(deactivating ? { confirm_email: confirmationEmail.trim() } : {}),
          ...(needsOffices ? { office_ids: officeIds } : {}),
          ...(deactivating && replacementId ? { replacement_owner_id: replacementId } : {}),
        },
        message: deactivating ? `${name} quedó desactivada.` : `${name} quedó reactivada.`,
      },
      { onSuccess: onDone }
    )

  return (
    <Stack gap="md">
      {deactivating ? (
        <>
          <Text size="sm">
            Al desactivar a <strong>{name}</strong>, pierde el acceso de inmediato y se cierran sus
            sesiones abiertas. Su historial se conserva.
          </Text>
          {impact.isPending ? (
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="sm" c="dimmed">
                Revisando sus activos y tareas…
              </Text>
            </Group>
          ) : impact.isError || !impact.data ? (
            <Alert color="red" title="No se pudo revisar el impacto">
              <Stack gap="xs">
                <Text size="sm">
                  No desactivaremos a la persona hasta poder mostrar sus activos y tareas afectados.
                </Text>
                <Button size="xs" variant="light" onClick={() => void impact.refetch()}>
                  Reintentar
                </Button>
              </Stack>
            </Alert>
          ) : (
            <>
              <MetricsStrip
                isPending={false}
                metrics={[
                  {
                    key: 'assets',
                    icon: Package,
                    value: ownedAssets.length,
                    label: 'Activos a su cargo',
                  },
                  {
                    key: 'in-progress',
                    icon: ClipboardList,
                    value: impact.data.in_progress_tasks,
                    label: 'Tareas en curso que vuelven a pendientes',
                  },
                  {
                    key: 'assigned',
                    icon: ClipboardList,
                    value: impact.data.assigned_tasks,
                    label: 'Tareas asignadas que piden reasignación',
                  },
                ]}
              />
              <Alert color="gray" icon={<Info size={16} strokeWidth={1.5} />}>
                Los activos que admiten reasignación pueden pasar a la persona que elijas; los demás
                quedarán sin responsable. Las tareas en curso que esta persona reclamó volverán a
                pendientes. Las tareas abiertas asignadas a su nombre no se reasignarán
                automáticamente.
              </Alert>
              {ownedAssets.length > 0 && (
                <MemberSelect
                  label="Nuevo responsable de sus activos"
                  description="Debe cubrir las oficinas de esos activos. Si no eliges a nadie, quedan sin responsable."
                  members={candidates}
                  emptyOption={{
                    value: NO_REPLACEMENT,
                    label: 'No asignar (quedan sin responsable)',
                  }}
                  value={replacementId ?? NO_REPLACEMENT}
                  onChange={value =>
                    setReplacementId(value && value !== NO_REPLACEMENT ? value : null)
                  }
                  comboboxProps={{ withinPortal: true }}
                />
              )}
            </>
          )}
        </>
      ) : (
        <>
          <Text size="sm">
            <strong>{name}</strong> vuelve a tener acceso con su rol anterior.
          </Text>
          <Alert color="gray" icon={<Info size={16} strokeWidth={1.5} />}>
            <Text size="sm">
              No se restaura nada más: los activos que quedaron sin responsable no se le asignan
              nuevamente, y las tareas que volvieron a pendientes no se reclaman automáticamente. Si
              corresponde, reasigna los activos y las tareas manualmente.
            </Text>
          </Alert>
        </>
      )}
      {deactivating && (
        <TextInput
          label="Para confirmar, escribe el correo de la persona"
          description={member.email}
          type="email"
          autoComplete="off"
          value={confirmationEmail}
          onChange={event => setConfirmationEmail(event.currentTarget.value)}
          error={confirmationEmail && !emailMatches ? 'El correo no coincide.' : undefined}
        />
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
          disabled={
            (needsOffices && !officeIds.length) ||
            (deactivating && (impact.isPending || impact.isError || !impact.data || !emailMatches))
          }
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
