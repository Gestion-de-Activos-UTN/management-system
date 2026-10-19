'use client'

import { useState } from 'react'
import { Alert, Button, Group, Loader, Modal, Stack, Text, TextInput } from '@mantine/core'
import {
  Building2,
  ClipboardX,
  Info,
  Package,
  Power,
  PowerOff,
  RadioTower,
  Server,
  Users,
} from 'lucide-react'
import type { Organization } from '@/app/types/payload-types'
import { MetricsStrip } from '@/components/ui/MetricsStrip'
import { useOrganizationStatusImpact, useSetOrganizationStatus } from '../hooks/use-organizations'

/**
 * Desactivar o reactivar una organización (sólo PlatformAdmin). Desactivar da de baja todo y se
 * confirma escribiendo el nombre; reactivar vuelve sólo con su OrgAdmin y su oficina más antiguos.
 */
export function OrganizationStatusModal({
  organization,
  onClose,
}: {
  organization: Organization | null
  onClose: () => void
}) {
  const deactivating = organization?.is_active !== false
  return (
    <Modal
      opened={Boolean(organization)}
      onClose={onClose}
      title={deactivating ? 'Desactivar organización' : 'Reactivar organización'}
      size={deactivating ? 'xl' : 'md'}
      centered
    >
      {organization && (
        // key: cada organización arranca con su propia confirmación.
        <OrganizationStatusForm
          key={organization.id}
          organization={organization}
          onClose={onClose}
        />
      )}
    </Modal>
  )
}

function OrganizationStatusForm({
  organization,
  onClose,
}: {
  organization: Organization
  onClose: () => void
}) {
  const impact = useOrganizationStatusImpact(String(organization.id))
  const setStatus = useSetOrganizationStatus()
  const [confirmName, setConfirmName] = useState('')

  if (impact.isPending)
    return (
      <Group gap="xs">
        <Loader size="xs" />
        <Text size="sm" c="dimmed">
          Revisando qué se ve afectado…
        </Text>
      </Group>
    )
  if (impact.isError || !impact.data)
    return <Text c="red">No se pudo calcular el impacto sobre esta organización.</Text>

  const id = String(organization.id)
  const actions = (
    confirmLabel: string,
    onConfirm: () => void,
    { danger, disabled }: { danger: boolean; disabled: boolean }
  ) => (
    <Group justify="flex-end" gap="xs">
      <Button variant="default" onClick={onClose}>
        Cancelar
      </Button>
      <Button
        color={danger ? 'red' : undefined}
        disabled={disabled}
        loading={setStatus.isPending}
        leftSection={
          danger ? <PowerOff size={16} strokeWidth={1.5} /> : <Power size={16} strokeWidth={1.5} />
        }
        onClick={onConfirm}
      >
        {confirmLabel}
      </Button>
    </Group>
  )

  if (!impact.data.is_active) {
    const { admin, office } = impact.data.reactivation
    return (
      <Stack gap="md">
        {admin && office ? (
          <Text size="sm">
            <strong>{organization.name}</strong> vuelve con lo mínimo para operar: se reactiva a{' '}
            <strong>{admin.name || admin.email}</strong> como administrador y la oficina{' '}
            <strong>{office.name}</strong>, y se abren sus revisiones de seguridad.
          </Text>
        ) : (
          <Alert color="red" icon={<Info size={16} strokeWidth={1.5} />}>
            No queda ninguna persona administradora u oficina para reactivar esta organización.
          </Alert>
        )}
        <Alert color="gray" icon={<Info size={16} strokeWidth={1.5} />}>
          No se restaura nada más: el resto de las personas y oficinas, los escáneres y los activos
          dados de baja quedan como están y se reactivan aparte.
        </Alert>
        {actions(
          'Reactivar organización',
          () => setStatus.mutate({ id, input: { is_active: true } }, { onSuccess: onClose }),
          { danger: false, disabled: !admin || !office }
        )}
      </Stack>
    )
  }

  const data = impact.data.deactivation
  const nameMatches = confirmName.trim() === organization.name.trim()
  return (
    <Stack gap="md">
      <Text size="sm">
        Al desactivar <strong>{organization.name}</strong> se da de baja todo en un solo paso:
      </Text>
      <MetricsStrip
        isPending={false}
        metrics={[
          { key: 'offices', icon: Building2, value: data.offices, label: 'Oficinas desactivadas' },
          { key: 'members', icon: Users, value: data.members, label: 'Personas desactivadas' },
          { key: 'agents', icon: RadioTower, value: data.agents, label: 'Escáneres revocados' },
          {
            key: 'network',
            icon: Server,
            value: data.network_assets,
            label: 'Activos de red dados de baja',
          },
          {
            key: 'manual',
            icon: Package,
            value: data.manual_assets,
            label: 'Activos manuales dados de baja',
          },
          { key: 'tasks', icon: ClipboardX, value: data.open_tasks, label: 'Tareas canceladas' },
        ]}
      />
      <Text size="xs" c="dimmed">
        También se cierran las revisiones de seguridad abiertas. Nadie de la organización puede
        volver a ingresar hasta que se reactive.
      </Text>
      <Alert color="gray" icon={<Info size={16} strokeWidth={1.5} />}>
        Reactivarla no restaura nada de esto: vuelve sólo su administrador y su oficina más
        antiguos.
      </Alert>
      <TextInput
        label="Para confirmar, escribe el nombre de la organización"
        description={organization.name}
        value={confirmName}
        onChange={event => setConfirmName(event.currentTarget.value)}
        autoComplete="off"
      />
      {actions(
        'Desactivar organización',
        () =>
          setStatus.mutate(
            { id, input: { is_active: false, confirm_name: confirmName.trim() } },
            { onSuccess: onClose, onError: () => void impact.refetch() }
          ),
        { danger: true, disabled: !nameMatches }
      )}
    </Stack>
  )
}
