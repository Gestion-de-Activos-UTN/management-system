'use client'

import { ModalLayout } from '@/components/ui/ModalLayout'
import { useState } from 'react'
import { Alert, Button, Group, Loader, Modal, Text, TextInput } from '@mantine/core'
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
 * confirma escribiendo el nombre; reactivar habilita la primera persona administradora disponible
 * y la oficina más antigua.
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
      <ModalLayout
        footer={actions(
          'Reactivar organización',
          () => setStatus.mutate({ id, input: { is_active: true } }, { onSuccess: onClose }),
          { danger: false, disabled: !admin || !office }
        )}
      >
        {admin && office ? (
          <Text size="sm">
            Al reactivar <strong>{organization.name}</strong>, vuelven a estar disponibles{' '}
            <strong>{admin.name || admin.email}</strong> como administrador y la oficina{' '}
            <strong>{office.name}</strong>. Se abren nuevas revisiones de seguridad.
          </Text>
        ) : (
          <Alert color="red" icon={<Info size={16} strokeWidth={1.5} />}>
            No queda ninguna persona administradora u oficina para reactivar esta organización.
          </Alert>
        )}
        <Alert color="gray" icon={<Info size={16} strokeWidth={1.5} />}>
          No se restaura nada más: las demás personas y oficinas, los escáneres revocados y los
          activos dados de baja quedan como están. Reactívalos por separado si corresponde.
        </Alert>
      </ModalLayout>
    )
  }

  const data = impact.data.deactivation
  const nameMatches = confirmName.trim() === organization.name.trim()
  return (
    <ModalLayout
      footer={actions(
        'Desactivar organización',
        () =>
          setStatus.mutate(
            { id, input: { is_active: false, confirm_name: confirmName.trim() } },
            { onSuccess: onClose, onError: () => void impact.refetch() }
          ),
        { danger: true, disabled: !nameMatches }
      )}
    >
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
        Al reactivarla, vuelven a estar disponibles la persona administradora disponible más antigua
        y la oficina más antigua. El resto de las personas, oficinas, escáneres y activos no se
        restaura automáticamente.
      </Alert>
      <TextInput
        label="Para confirmar, escribe el nombre de la organización"
        withAsterisk
        description={organization.name}
        value={confirmName}
        onChange={event => setConfirmName(event.currentTarget.value)}
        autoComplete="off"
      />
    </ModalLayout>
  )
}
