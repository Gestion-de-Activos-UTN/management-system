'use client'

import { useState } from 'react'
import {
  Alert,
  Button,
  Divider,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import {
  ClipboardX,
  Info,
  Package,
  Power,
  PowerOff,
  RadioTower,
  Server,
  UserMinus,
  UserX,
} from 'lucide-react'
import type { Office } from '@/app/types/payload-types'
import { MetricsStrip } from '@/components/ui/MetricsStrip'
import { ASSET_CATEGORY_LABEL } from '@/lib/enum-labels'
import { roleSlugLabel } from '@/lib/role-labels'
import type { OfficeDeactivationImpact } from '@/domain/offices/office-lifecycle'
import { useOfficeDeactivationImpact, useSetOfficeStatus } from '../hooks/use-offices'

const NOTHING_RESTORED =
  'Reactivar la oficina no restaura nada de esto: ni escáneres, ni personas, ni activos movidos o dados de baja.'

/**
 * Desactivar o reactivar una oficina. Al desactivar, un único cuadro muestra todo lo que va a
 * pasar, pide el destino de cada activo manual y se confirma escribiendo el nombre de la oficina.
 */
export function OfficeStatusModal({
  office,
  onClose,
  asOrganization,
}: {
  office: Office | null
  onClose: () => void
  asOrganization?: string
}) {
  const deactivating = office?.is_active !== false
  return (
    <Modal
      opened={Boolean(office)}
      onClose={onClose}
      title={deactivating ? 'Desactivar oficina' : 'Reactivar oficina'}
      size={deactivating ? 'xl' : 'md'}
      centered
    >
      {office &&
        (deactivating ? (
          // key: cada oficina arranca con sus propias elecciones.
          <DeactivateOffice
            key={office.id}
            office={office}
            onClose={onClose}
            asOrganization={asOrganization}
          />
        ) : (
          <ReactivateOffice office={office} onClose={onClose} asOrganization={asOrganization} />
        ))}
    </Modal>
  )
}

function ReactivateOffice({
  office,
  onClose,
  asOrganization,
}: {
  office: Office
  onClose: () => void
  asOrganization?: string
}) {
  const setStatus = useSetOfficeStatus(asOrganization)
  return (
    <Stack gap="md">
      <Text size="sm">
        <strong>{office.name}</strong> vuelve a estar disponible y se abre una nueva revisión de
        seguridad de la oficina, visible para quienes administran la organización.
      </Text>
      <Alert color="gray" icon={<Info size={16} strokeWidth={1.5} />}>
        No se restaura nada más: los escáneres revocados, las personas desactivadas y los activos
        movidos o dados de baja quedan como están. Hay que instalar un escáner nuevo y reactivar a
        cada persona desde Usuarios.
      </Alert>
      <Group justify="flex-end" gap="xs">
        <Button variant="default" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          loading={setStatus.isPending}
          leftSection={<Power size={16} strokeWidth={1.5} />}
          onClick={() =>
            setStatus.mutate(
              { id: String(office.id), input: { is_active: true } },
              { onSuccess: onClose }
            )
          }
        >
          Reactivar oficina
        </Button>
      </Group>
    </Stack>
  )
}

function DeactivateOffice({
  office,
  onClose,
  asOrganization,
}: {
  office: Office
  onClose: () => void
  asOrganization?: string
}) {
  const impact = useOfficeDeactivationImpact(String(office.id), asOrganization)
  const setStatus = useSetOfficeStatus(asOrganization)
  const [moves, setMoves] = useState<Record<string, string>>({})
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
    return <Text c="red">No se pudo calcular el impacto de desactivar esta oficina.</Text>

  const data = impact.data
  const destinations = data.destination_offices.map(o => ({ value: o.id, label: o.name }))
  const allMoved = data.manual_assets.every(asset => moves[asset.id])
  const nameMatches = confirmName.trim() === office.name.trim()

  const confirm = () =>
    setStatus.mutate(
      {
        id: String(office.id),
        input: {
          is_active: false,
          confirm_name: confirmName.trim(),
          manual_asset_moves: data.manual_assets.map(asset => ({
            asset_id: asset.id,
            office_id: moves[asset.id],
          })),
        },
      },
      // Si mientras tanto cambió lo afectado, el servidor lo rechaza: se recarga el impacto.
      { onSuccess: onClose, onError: () => void impact.refetch() }
    )

  return (
    <Stack gap="md">
      <Text size="sm">
        Al desactivar <strong>{office.name}</strong> pasa todo esto en un solo paso:
      </Text>
      <ImpactStrip impact={data} />
      {data.open_assessment && (
        <Text size="xs" c="dimmed">
          También se cierra la revisión de seguridad abierta de la oficina.
        </Text>
      )}

      {data.manual_assets.length > 0 && (
        <Stack gap="xs">
          <Divider label="Activos manuales: elige a qué oficina va cada uno" labelPosition="left" />
          <Text size="xs" c="dimmed">
            Llegan sin responsable ni ubicación; el resto de sus datos se conserva. Después hay que
            asignarles un responsable en la oficina nueva.
          </Text>
          <Select
            label="Mover todos a…"
            placeholder="Elige una oficina"
            data={destinations}
            onChange={value =>
              value &&
              setMoves(Object.fromEntries(data.manual_assets.map(asset => [asset.id, value])))
            }
          />
          <ScrollArea.Autosize mah={240} type="auto">
            <Stack gap={6}>
              {data.manual_assets.map(asset => (
                <Group key={asset.id} gap="sm" wrap="nowrap" justify="space-between">
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" fw={600} truncate>
                      {asset.name}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {ASSET_CATEGORY_LABEL[asset.category] ?? asset.category}
                      {asset.owner_name ? ` · Responsable: ${asset.owner_name}` : ''}
                    </Text>
                  </div>
                  <Select
                    aria-label={`Oficina de destino de ${asset.name}`}
                    placeholder="Destino"
                    w={200}
                    data={destinations}
                    value={moves[asset.id] ?? null}
                    onChange={value =>
                      setMoves(current => {
                        const next = { ...current }
                        if (value) next[asset.id] = value
                        else delete next[asset.id]
                        return next
                      })
                    }
                  />
                </Group>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      )}

      <MemberList
        icon={UserX}
        color="red"
        title="Se desactivan (se quedan sin oficinas)"
        members={data.members_without_office}
        note="Sus tareas en curso vuelven a pendientes y sus activos quedan sin responsable."
      />
      <MemberList
        icon={UserMinus}
        color="yellow"
        title="Pierden el acceso a esta oficina"
        members={data.members_losing_office}
        note="Sus tareas en curso y sus activos de esta oficina quedan liberados."
      />

      <Alert color="gray" icon={<Info size={16} strokeWidth={1.5} />}>
        {NOTHING_RESTORED}
      </Alert>

      <TextInput
        label="Para confirmar, escribe el nombre de la oficina"
        description={office.name}
        value={confirmName}
        onChange={event => setConfirmName(event.currentTarget.value)}
        autoComplete="off"
      />

      <Group justify="flex-end" gap="xs">
        <Button variant="default" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          color="red"
          disabled={!nameMatches || !allMoved}
          loading={setStatus.isPending}
          leftSection={<PowerOff size={16} strokeWidth={1.5} />}
          onClick={confirm}
        >
          Desactivar oficina
        </Button>
      </Group>
    </Stack>
  )
}

function ImpactStrip({ impact }: { impact: OfficeDeactivationImpact }) {
  return (
    <MetricsStrip
      isPending={false}
      metrics={[
        { key: 'agents', icon: RadioTower, value: impact.agents, label: 'Escáneres revocados' },
        {
          key: 'network',
          icon: Server,
          value: impact.network_assets,
          label: 'Activos de red dados de baja',
        },
        {
          key: 'manual',
          icon: Package,
          value: impact.manual_assets.length,
          label: 'Activos manuales a mover',
        },
        { key: 'tasks', icon: ClipboardX, value: impact.open_tasks, label: 'Tareas canceladas' },
        {
          key: 'members',
          icon: UserX,
          value: impact.members_without_office.length,
          label: 'Personas desactivadas',
          description: impact.members_losing_office.length
            ? `${impact.members_losing_office.length} más pierden esta oficina`
            : undefined,
        },
      ]}
    />
  )
}

function MemberList({
  icon: Icon,
  color,
  title,
  members,
  note,
}: {
  icon: typeof UserX
  color: string
  title: string
  members: OfficeDeactivationImpact['members_without_office']
  note: string
}) {
  if (!members.length) return null
  return (
    <Alert color={color} icon={<Icon size={16} strokeWidth={1.5} />} title={title}>
      <Stack gap={4}>
        <Text size="sm">
          {members
            .map(member => `${member.name || member.email} (${roleSlugLabel(member.role)})`)
            .join(', ')}
        </Text>
        <Text size="xs" c="dimmed">
          {note}
        </Text>
      </Stack>
    </Alert>
  )
}
