'use client'

import { ModalLayout } from '@/components/ui/ModalLayout'
import { useState } from 'react'
import {
  Alert,
  Button,
  Divider,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import {
  Archive,
  ArrowRightLeft,
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
import { DataTable } from '@/components/ui/DataTable'
import { roleSlugLabel } from '@/lib/role-labels'
import type { OfficeDeactivationImpact } from '@/domain/offices/office-lifecycle'
import { useOfficeDeactivationImpact, useSetOfficeStatus } from '../hooks/use-offices'
import { RETIRE_MANUAL_ASSET } from '../schema'
import { getManualAssetDecisionColumns } from '../office-deactivation.columns'

const SCANNERS_STOP =
  'Los escáneres de la oficina se detienen solos en menos de 5 minutos y no vuelven a analizar la red. Para quitarlos del equipo, desinstálalos a mano.'

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
    <ModalLayout
      gap="md"
      footer={
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
      }
    >
      <Text size="sm">
        <strong>{office.name}</strong> vuelve a estar disponible y se abre una nueva revisión de
        seguridad de la oficina, visible para quienes administran la organización.
      </Text>
      <Alert color="gray" icon={<Info size={16} strokeWidth={1.5} />}>
        No se restaura nada más: los escáneres revocados, las personas desactivadas y los activos
        movidos o dados de baja quedan como están. Hay que instalar un escáner nuevo y reactivar a
        cada persona desde Usuarios.
      </Alert>
    </ModalLayout>
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
  // Activo manual → id de la oficina de destino, o RETIRE_MANUAL_ASSET para darlo de baja.
  const [decisions, setDecisions] = useState<Record<string, string>>({})
  // Activos marcados en la tabla: sobre ellos se aplica la acción en bloque.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [movingAssetId, setMovingAssetId] = useState<string | null>(null)
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
  const officeName = (id: string) => destinations.find(o => o.value === id)?.label ?? 'otra oficina'
  // El "todos" del encabezado apunta a lo que falta decidir; cuando ya está todo decidido, a
  // todos, para poder cambiar una decisión en bloque.
  const undecided = data.manual_assets.filter(asset => !decisions[asset.id]).map(a => a.id)
  const bulkIds = undecided.length ? undecided : data.manual_assets.map(asset => asset.id)
  // La decisión queda pendiente hasta confirmar la baja; al aplicarla se libera la selección.
  const decideAssets = (assetIds: string[], destination: string) => {
    setDecisions(current => ({
      ...current,
      ...Object.fromEntries(assetIds.map(id => [id, destination])),
    }))
    setSelected(current => {
      const next = new Set(current)
      assetIds.forEach(id => next.delete(id))
      return next
    })
    setMovingAssetId(null)
  }
  const decide = (destination: string) => {
    decideAssets([...selected], destination)
  }
  const clearDecision = (assetId: string) =>
    setDecisions(current => {
      const next = { ...current }
      delete next[assetId]
      return next
    })
  const columns = getManualAssetDecisionColumns({
    selected,
    decisions,
    officeName,
    destinations,
    movingAssetId,
    onMoveOpen: (assetId, opened) => setMovingAssetId(opened ? assetId : null),
    onDecide: (assetId, destination) => decideAssets([assetId], destination),
    onClearDecision: clearDecision,
    bulkIds,
    onToggle: (id, checked) =>
      setSelected(current => {
        const next = new Set(current)
        if (checked) next.add(id)
        else next.delete(id)
        return next
      }),
    onToggleAll: checked => setSelected(new Set(checked ? bulkIds : [])),
  })
  const allDecided = data.manual_assets.every(asset => decisions[asset.id])
  const nameMatches = confirmName.trim() === office.name.trim()

  const confirm = () =>
    setStatus.mutate(
      {
        id: String(office.id),
        input: {
          is_active: false,
          confirm_name: confirmName.trim(),
          manual_asset_decisions: data.manual_assets.map(asset => ({
            asset_id: asset.id,
            destination: decisions[asset.id],
          })),
        },
      },
      // Si mientras tanto cambió lo afectado, el servidor lo rechaza: se recarga el impacto.
      { onSuccess: onClose, onError: () => void impact.refetch() }
    )

  return (
    <ModalLayout
      gap="md"
      footer={
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            color="red"
            disabled={!nameMatches || !allDecided}
            loading={setStatus.isPending}
            leftSection={<PowerOff size={16} strokeWidth={1.5} />}
            onClick={confirm}
          >
            Desactivar oficina
          </Button>
        </Group>
      }
    >
      <Text size="sm">
        Al desactivar <strong>{office.name}</strong> pasa todo esto en un solo paso:
      </Text>
      <ImpactStrip impact={data} decisions={decisions} />
      {data.open_assessment && (
        <Text size="xs" c="dimmed">
          También se cierra la revisión de seguridad abierta de la oficina.
        </Text>
      )}

      {data.manual_assets.length > 0 && (
        <Stack gap="xs">
          <Divider label="Activos manuales: decide qué pasa con cada uno" labelPosition="left" />
          <Text size="sm" c="dimmed">
            Decide desde cada fila o selecciona varias para aplicarles la misma acción. Mover
            conserva el historial y las tareas, pero quita responsable y ubicación; dar de baja
            cancela las tareas abiertas. Los cambios se aplican al confirmar.
          </Text>
          {selected.size > 0 && (
            <Group gap="xs" align="center" wrap="wrap">
              <Text size="sm" fw={600}>
                {selected.size} {selected.size === 1 ? 'seleccionado' : 'seleccionados'}
              </Text>
              {destinations.length > 0 && (
                <Select
                  aria-label="Mover los activos seleccionados a otra oficina"
                  placeholder="Mover a otra oficina…"
                  data={destinations}
                  value={null}
                  onChange={value => value && decide(value)}
                  size="sm"
                  w={280}
                  leftSection={<ArrowRightLeft size={16} strokeWidth={1.5} />}
                />
              )}
              <Button
                size="sm"
                variant="light"
                color="orange"
                leftSection={<Archive size={16} strokeWidth={1.5} />}
                onClick={() => decide(RETIRE_MANUAL_ASSET)}
              >
                Dar de baja
              </Button>
              <Button size="sm" variant="subtle" onClick={() => setSelected(new Set())}>
                Limpiar selección
              </Button>
            </Group>
          )}
          {destinations.length === 0 && (
            <Text size="xs" c="dimmed">
              No hay otra oficina activa a la que mover estos activos.
            </Text>
          )}
          <DataTable
            columns={columns}
            data={data.manual_assets}
            minWidth={540}
            maxHeight={data.manual_assets.length > 5 ? 'min(360px, 48vh)' : 'none'}
            stickyHeader={data.manual_assets.length > 5}
          />
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

      {data.agents > 0 && (
        <Alert color="yellow" icon={<RadioTower size={16} strokeWidth={1.5} />}>
          {SCANNERS_STOP}
        </Alert>
      )}

      <Alert color="gray" icon={<Info size={16} strokeWidth={1.5} />}>
        {NOTHING_RESTORED}
      </Alert>

      <TextInput
        label="Para confirmar, escribe el nombre de la oficina"
        withAsterisk
        description={office.name}
        value={confirmName}
        onChange={event => setConfirmName(event.currentTarget.value)}
        autoComplete="off"
      />
    </ModalLayout>
  )
}

function ImpactStrip({
  impact,
  decisions,
}: {
  impact: OfficeDeactivationImpact
  decisions: Record<string, string>
}) {
  const retiring = impact.manual_assets.filter(asset => decisions[asset.id] === RETIRE_MANUAL_ASSET)
  const moving = impact.manual_assets.filter(
    asset => decisions[asset.id] && decisions[asset.id] !== RETIRE_MANUAL_ASSET
  ).length
  const pending = impact.manual_assets.length - retiring.length - moving
  // Las tareas de un activo manual se cancelan sólo si ese activo se da de baja.
  const cancelledTasks =
    impact.open_tasks + retiring.reduce((total, asset) => total + asset.open_tasks, 0)
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
          label: 'Activos manuales',
          description: impact.manual_assets.length
            ? [
                `${moving} a mover`,
                `${retiring.length} de baja`,
                ...(pending ? [`${pending} sin decidir`] : []),
              ].join(' · ')
            : undefined,
        },
        { key: 'tasks', icon: ClipboardX, value: cancelledTasks, label: 'Tareas canceladas' },
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
