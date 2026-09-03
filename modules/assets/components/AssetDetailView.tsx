'use client'

import { useEffect, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  List,
  Modal,
  Select,
  SimpleGrid,
  Spoiler,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { PageHeader } from '@/components/ui/PageHeader'
import { TechnicalText } from '@/components/ui/TechnicalText'
import { useOrgMembers } from '@/modules/users/hooks/use-org-members'
import { CRITICALITY_OPTIONS, MANUAL_ASSET_STATUS_OPTIONS } from '@/lib/enum-labels'
import { formatDateTime } from '@/lib/format-date'
import type { Asset } from '@/app/types/payload-types'
import { AssetBusinessFieldsSchema, type AssetBusinessFields } from '../schema'
import { useUpdateAsset } from '../hooks/use-update-asset'
import { useMarkAssetViewed } from '../hooks/use-mark-asset-viewed'
import { useMarkAssetChangesViewed } from '../hooks/use-mark-asset-changes-viewed'
import { useIdentifyAsset } from '../hooks/use-identify-asset'
import { BadgeCheck, Lock } from 'lucide-react'
import {
  DEVICE_CATEGORY_HELP,
  DEVICE_CATEGORY_LABEL,
  GENERIC_IDENTIFICATION_HELP,
  inferDeviceCategory,
} from '../inferDeviceCategory'

// Tentativa siempre, nunca se escribe a ningún campo — solo orienta al usuario en qué mirar para
// confirmar el tipo real de dispositivo. IP-only/IP+vendor es el caso común de un scan real (doc
// 05 "qué no asumir"), así que sin señal clara mostramos ayuda genérica en vez de nada.
function IdentificationHelpCard({ asset }: { asset: Asset }) {
  const inference = inferDeviceCategory(asset)

  if (inference.tier === 'unknown' || !inference.category) {
    return (
      <Card withBorder padding="lg">
        <Stack gap="sm">
          <Text fw={600}>Identification help</Text>
          <Text size="sm" c="dimmed">
            Not enough technical data to guess a device type. General steps to identify it manually:
          </Text>
          <List size="sm" spacing={4}>
            {GENERIC_IDENTIFICATION_HELP.map(step => (
              <List.Item key={step}>{step}</List.Item>
            ))}
          </List>
        </Stack>
      </Card>
    )
  }

  const { category, tier, signals } = inference
  return (
    <Card withBorder padding="lg">
      <Stack gap="sm">
        <Group gap="xs">
          <Text fw={600}>Identification help</Text>
          <Badge variant="light" color={tier === 'likely' ? 'pine' : 'gray'}>
            {tier === 'likely' ? 'Likely' : 'Possible'}: {DEVICE_CATEGORY_LABEL[category]}
          </Badge>
        </Group>
        <Text size="xs" c="dimmed">
          Based on {signals.join(', ')} — a guess, not a fact. Verify with the steps below.
        </Text>
        <List size="sm" spacing={4}>
          {DEVICE_CATEGORY_HELP[category].map(step => (
            <List.Item key={step}>{step}</List.Item>
          ))}
        </List>
      </Stack>
    </Card>
  )
}

function TechnicalRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <Group justify="space-between" align="flex-start" wrap="wrap" gap="xs">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <TechnicalText
        style={{
          flex: '1 1 220px',
          minWidth: 0,
          textAlign: 'right',
          overflowWrap: 'anywhere',
        }}
      >
        {value || '—'}
      </TechnicalText>
    </Group>
  )
}

type Service = NonNullable<Asset['services']>[number]
type OsCandidate = NonNullable<Asset['os_candidates']>[number]

// Escala simple 0-10 (nmap "conf") -> semáforo de contraste ya usado en el resto de la UI
// (criticality/status badges): no hay ningún badge de confianza reusable en el repo (ver
// análisis previo), así que este es chico y local a esta vista.
function confidenceColor(confidence: number | null | undefined): string {
  if (confidence == null) return 'gray'
  if (confidence >= 7) return 'green'
  if (confidence >= 4) return 'yellow'
  return 'red'
}

function scriptsText(scripts: unknown): string | null {
  if (!scripts || typeof scripts !== 'object') return null
  const entries = Object.entries(scripts as Record<string, string>)
  if (entries.length === 0) return null
  return entries.map(([id, output]) => `${id}:\n${output}`).join('\n\n')
}

// Solo cuando hay más de un candidato — con uno solo es el mismo dato que ya muestra la fila
// "Operating system" de arriba, repetirlo no aporta nada.
function OsCandidatesRow({ candidates }: { candidates: Asset['os_candidates'] }) {
  const list = candidates ?? []
  if (list.length < 2) return null

  return (
    <Group justify="space-between" align="flex-start" wrap="wrap" gap="xs">
      <Text size="sm" c="dimmed">
        OS candidates
      </Text>
      <List size="sm" spacing={2} style={{ flex: '1 1 220px', textAlign: 'right' }} listStyleType="none">
        {list.map((candidate: OsCandidate, i: number) => (
          <List.Item key={candidate.id ?? i}>
            <TechnicalText>
              {candidate.name || 'Unknown'} ({candidate.accuracy ?? 0}%)
            </TechnicalText>
          </List.Item>
        ))}
      </List>
    </Group>
  )
}

// nmap devuelve nombres de servicio en jerga cruda ("dhcpc"/"domain") — mapeo chico solo para
// lo que aparece en la práctica; lo desconocido cae al nombre crudo, no rompe nada.
const SERVICE_NAME_LABEL: Record<string, string> = {
  domain: 'DNS',
  dhcps: 'DHCP (server)',
  dhcpc: 'DHCP (client)',
  ntp: 'NTP',
  http: 'HTTP',
  https: 'HTTPS',
  ssh: 'SSH',
}

function serviceChipLabel(service: Service): string {
  return `${service.port ?? '?'}/${service.protocol ?? '?'}`
}

// nmap reporta "nginx" en minúscula (no es un acrónimo con casing propio como DNS/NTP) — se
// corrige puntual en vez de un toUpperCase() global, que rompía el casing ya prolijo del resto
// (product strings como "GoAhead WebServer" o los labels de SERVICE_NAME_LABEL de arriba).
function fixKnownCasing(text: string): string {
  return text.replace(/nginx/gi, 'NGINX')
}

function serviceDescription(service: Service): string {
  if (service.product) return fixKnownCasing(service.product)
  if (service.name) return SERVICE_NAME_LABEL[service.name.toLowerCase()] ?? service.name
  return 'Unknown service'
}

const SERVICE_CHIPS_VISIBLE = 3

// `services: []` es un dato confirmado, no una ausencia (ver inferDeviceCategory.ts) — por eso
// se distingue explícitamente de "no hay puertos" en vez de mostrar el mismo "—" que un campo
// que simplemente no se pudo resolver (mac/vendor/hostname). Chips compactos en vez de una lista
// vertical cruda — con 4+ servicios esa lista estiraba la fila mucho más que cualquier otra del
// bloque técnico; el detalle completo vive en el modal, no en la fila.
function ServicesRow({ services }: { services: Asset['services'] }) {
  const [modalOpen, setModalOpen] = useState(false)
  const list = services ?? []

  if (list.length === 0) {
    return (
      <Group justify="space-between" wrap="wrap" gap="xs">
        <Text size="sm" c="dimmed">
          Services
        </Text>
        <Text size="sm" c="dimmed">
          No open ports detected
        </Text>
      </Group>
    )
  }

  const visible = list.slice(0, SERVICE_CHIPS_VISIBLE)
  const overflowCount = list.length - visible.length

  return (
    <>
      {/* align="center": con "flex-start" el label "Services" quedaba desalineado contra la
          altura real de los badges (que traen su propio padding vertical) en el caso común de
          una sola línea de chips — center los alinea por su punto medio en vez de por el tope. */}
      <Group justify="space-between" wrap="wrap" align="center" gap="xs">
        <Text size="sm" c="dimmed">
          Services
        </Text>
        <Group
          gap={6}
          justify="flex-end"
          wrap="wrap"
          align="center"
          maw={{ base: '100%', sm: '70%' }}
        >
          {visible.map((service, i) => (
            <Tooltip key={service.id ?? i} label={serviceDescription(service)}>
              {/* variant="outline" + color="pine": "light" gray quedaba casi sin contraste
                  contra el fondo "bone" del tema — mismo acento pine que ya usa el resto de la
                  UI (chip "+N more", badge "New"), pero con borde en vez de relleno para no
                  competir visualmente con esos otros usos filled.
                  Sin ff="monospace"/tt="none": una fuente distinta a la del chip "+N more" tiene
                  métricas de línea distintas y descentraba el texto dentro del pill — mismo
                  estilo default de Badge en los dos, ambos quedan centrados igual. */}
              <Badge variant="outline" color="pine" size="sm">
                {serviceChipLabel(service)}
              </Badge>
            </Tooltip>
          ))}
          {overflowCount > 0 && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              // display/lineHeight: un <button> nativo trae su propio line-height de fuente de
              // formulario que border:none/padding:0 no tocan — eso deja aire invisible arriba/
              // abajo del Badge que tiene adentro, corriéndolo respecto a sus hermanos sin botón.
              // inline-flex + lineHeight:0 hace que el botón mida exactamente lo que mide el Badge.
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                lineHeight: 0,
                background: 'none',
                border: 'none',
                padding: 0,
                margin: 0,
                cursor: 'pointer',
              }}
            >
              <Badge variant="outline" color="pine" size="sm" style={{ cursor: 'pointer' }}>
                +{overflowCount} more
              </Badge>
            </button>
          )}
        </Group>
      </Group>

      <Modal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`Open services (${list.length})`}
        size="lg"
        centered
      >
        <Table.ScrollContainer minWidth={860}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Port</Table.Th>
                <Table.Th>Protocol</Table.Th>
                <Table.Th>Service</Table.Th>
                <Table.Th>Version</Table.Th>
                <Table.Th>Detection</Table.Th>
                <Table.Th>Confidence</Table.Th>
                <Table.Th>Scripts</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.map((service, i) => {
                const scripts = scriptsText(service.scripts)
                return (
                  <Table.Tr key={service.id ?? i}>
                    <Table.Td>
                      <TechnicalText>{service.port ?? '—'}</TechnicalText>
                    </Table.Td>
                    <Table.Td>{service.protocol ? service.protocol.toUpperCase() : '—'}</Table.Td>
                    <Table.Td>{serviceDescription(service)}</Table.Td>
                    <Table.Td>{service.version || '—'}</Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <Badge variant={service.detection_method === 'probed' ? 'filled' : 'outline'} color="pine" size="sm">
                          {service.detection_method || 'table'}
                        </Badge>
                        {service.tunnel === 'ssl' && (
                          <Tooltip label="Runs over an encrypted (SSL/TLS) tunnel">
                            <Lock size={14} strokeWidth={1.5} />
                          </Tooltip>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="light" color={confidenceColor(service.confidence)} size="sm">
                        {service.confidence ?? 0}/10
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {scripts ? (
                        <Spoiler maxHeight={0} showLabel="View" hideLabel="Hide">
                          <TechnicalText style={{ whiteSpace: 'pre-wrap' }}>{scripts}</TechnicalText>
                        </Spoiler>
                      ) : (
                        '—'
                      )}
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Modal>
    </>
  )
}

// El bloque técnico (ip..services) SIEMPRE se renderiza como texto, nunca en un <input> editable
// (RF-55) — aunque el servidor ya lo rechace (technicalFieldAccess), la UI no debe prometer una
// edición que no existe.
export function AssetDetailView({
  asset,
  asOrganization,
}: {
  asset: Asset
  asOrganization?: string
}) {
  const { data: members } = useOrgMembers(asOrganization)
  const updateAsset = useUpdateAsset(asset.id)
  const markViewed = useMarkAssetViewed(asset.id)
  const markChangesViewed = useMarkAssetChangesViewed(asset.id)
  const identify = useIdentifyAsset()

  // Ref, no un simple `if` en el render: evita reintentar en cada re-render mientras la mutation
  // está en vuelo (React StrictMode/HMR puede montar el efecto dos veces en dev) — el guard real
  // sigue siendo `first_viewed_at` en el servidor, esto solo evita spamear el PATCH.
  const hasTriedMarkViewed = useRef(false)
  useEffect(() => {
    if (asset.first_viewed_at == null && !hasTriedMarkViewed.current) {
      hasTriedMarkViewed.current = true
      markViewed.mutate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.id, asset.first_viewed_at])

  // Guard separado del de arriba: "Changed" no es sticky (a diferencia de "New"), así que este
  // efecto se rearma cada vez que un re-scan lo vuelve a prender, no solo la primera vez —
  // por eso el guard trackea el valor puntual ya procesado, no un boolean "ya intentado".
  const lastMarkedChangedAt = useRef<string | null>(null)
  useEffect(() => {
    if (asset.technical_changed_at != null && lastMarkedChangedAt.current !== asset.technical_changed_at) {
      lastMarkedChangedAt.current = asset.technical_changed_at
      markChangesViewed.mutate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.id, asset.technical_changed_at])

  const {
    control,
    handleSubmit,
    formState: { isDirty, dirtyFields, errors },
  } = useForm<AssetBusinessFields>({
    resolver: zodResolver(AssetBusinessFieldsSchema),
    defaultValues: {
      alias: asset.alias ?? null,
      criticality: asset.criticality ?? null,
      owner: typeof asset.owner === 'string' ? asset.owner : (asset.owner?.id ?? null),
      location: asset.location ?? null,
      status: asset.status ?? 'active',
    },
  })

  // Solo los campos que el usuario tocó, nunca el objeto completo: `defaultValues` se fija una
  // sola vez al montar y no se resincroniza si `asset` cambia después (ej. un re-scan que llega
  // mientras la página está abierta) — mandar todo el formulario reenviaría un `status` (u otro
  // campo de negocio) desactualizado y pisaría en silencio un cambio hecho por otro lado (bug
  // reportado: un asset retirado volvía a "active" al guardar un edit no relacionado).
  const onSubmit = handleSubmit(data => {
    const dirtyKeys = Object.keys(dirtyFields) as Array<keyof AssetBusinessFields>
    if (dirtyKeys.length === 0) return
    const changed = Object.fromEntries(dirtyKeys.map(key => [key, data[key]])) as Partial<AssetBusinessFields>
    updateAsset.mutate(changed)
  })

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <PageHeader
          title={asset.hostname || asset.alias || asset.ip || asset.asset_id}
          description="Read-only technical block (discovered by the scanner) plus editable business fields."
        />
        <Button
          variant={asset.identified ? 'light' : 'filled'}
          color="pine"
          leftSection={<BadgeCheck size={16} strokeWidth={1.5} />}
          loading={identify.isPending}
          onClick={() => identify.mutate({ id: asset.id, identified: !asset.identified })}
          w={{ base: '100%', sm: 'auto' }}
        >
          {asset.identified ? 'Mark as not identified' : 'Mark as identified'}
        </Button>
      </Group>

      <Card withBorder padding="lg">
        <Stack gap="xs">
          <TechnicalRow label="Asset ID" value={asset.asset_id} />
          <TechnicalRow label="IP" value={asset.ip} />
          <TechnicalRow label="Hostname" value={asset.hostname} />
          <TechnicalRow label="MAC" value={asset.mac} />
          <TechnicalRow label="Vendor" value={asset.vendor} />
          <TechnicalRow
            label="Operating system"
            value={
              asset.os_status === 'indeterminate'
                ? 'Indeterminate'
                : asset.os?.name
                  ? `${asset.os.name}${asset.os.accuracy != null ? ` (${asset.os.accuracy}%)` : ''}`
                  : null
            }
          />
          <OsCandidatesRow candidates={asset.os_candidates} />
          <TechnicalRow label="Discovery reason" value={asset.state_reason} />
          <TechnicalRow label="Gateway IP" value={asset.gateway_ip} />
          <TechnicalRow label="Gateway MAC" value={asset.gateway_mac} />
          <ServicesRow services={asset.services} />
          {scriptsText(asset.host_scripts) && (
            <Group justify="space-between" align="flex-start" wrap="wrap" gap="xs">
              <Text size="sm" c="dimmed">
                Host scripts
              </Text>
              <Spoiler
                maxHeight={0}
                showLabel="View"
                hideLabel="Hide"
                style={{ flex: '1 1 220px', textAlign: 'right' }}
              >
                <TechnicalText style={{ whiteSpace: 'pre-wrap' }}>
                  {scriptsText(asset.host_scripts)}
                </TechnicalText>
              </Spoiler>
            </Group>
          )}
          <TechnicalRow
            label="Last seen"
            value={asset.last_seen ? formatDateTime(asset.last_seen) : null}
          />
        </Stack>
      </Card>

      <IdentificationHelpCard asset={asset} />

      <Divider label="Business data" />

      {!asset.identified && (
        <Alert color="yellow" variant="light">
          This asset hasn&apos;t been identified yet. Confirm it as identified to edit its business
          fields.
        </Alert>
      )}

      {/* noValidate: same reason as modules/non-network-assets/components/NonNetworkAssetForm.tsx
          — native browser validation on a required <input> stops at the first invalid field
          and never lets RHF+Zod show every field's error at once. Applied here too even though
          no field is required today, so the pattern stays consistent the day one becomes. */}
      <form onSubmit={onSubmit} noValidate>
        <Stack gap="md">
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <Controller
              name="alias"
              control={control}
              render={({ field }) => (
                <TextInput
                  label="Alias"
                  maxLength={120}
                  disabled={!asset.identified}
                  // El slice es la barrera real: `maxLength` nativo ya bloquea el tipeo pero no
                  // un paste que lo supere en algunos navegadores/versiones — sin esto, un paste
                  // largo se guardaría completo en el estado de RHF aunque el input se vea corto.
                  value={field.value ?? ''}
                  onChange={e => field.onChange(e.currentTarget.value.slice(0, 120))}
                  error={errors.alias?.message}
                />
              )}
            />
            <Controller
              name="criticality"
              control={control}
              render={({ field }) => (
                <Select
                  label="Criticality"
                  data={CRITICALITY_OPTIONS}
                  disabled={!asset.identified}
                  value={field.value ?? null}
                  onChange={field.onChange}
                  clearable
                  error={errors.criticality?.message}
                />
              )}
            />
            <Controller
              name="owner"
              control={control}
              render={({ field }) => (
                <Select
                  label="Owner"
                  placeholder="Unassigned"
                  data={(members ?? []).map(m => ({
                    value: m.id,
                    label: `${m.name} (${m.email})`,
                  }))}
                  disabled={!asset.identified}
                  value={field.value ?? null}
                  onChange={field.onChange}
                  searchable
                  clearable
                  error={errors.owner?.message}
                />
              )}
            />
            <Controller
              name="location"
              control={control}
              render={({ field }) => (
                <TextInput
                  label="Location"
                  maxLength={200}
                  disabled={!asset.identified}
                  value={field.value ?? ''}
                  onChange={e => field.onChange(e.currentTarget.value.slice(0, 200))}
                  error={errors.location?.message}
                />
              )}
            />
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select
                  label="Status"
                  description="'Offline' is set automatically. You can reactivate to Active or retire."
                  // 'offline' nunca es una opción elegible a mano (RF-37); si el asset ya está
                  // offline se muestra deshabilitada para no ocultar el estado real.
                  data={
                    field.value === 'offline'
                      ? [
                          { value: 'offline', label: 'Offline (auto)', disabled: true },
                          ...MANUAL_ASSET_STATUS_OPTIONS,
                        ]
                      : MANUAL_ASSET_STATUS_OPTIONS
                  }
                  value={field.value}
                  onChange={v => field.onChange(v ?? 'active')}
                  error={errors.status?.message}
                />
              )}
            />
          </SimpleGrid>
          <Group justify="flex-end">
            <Button
              type="submit"
              loading={updateAsset.isPending}
              disabled={!isDirty}
              w={{ base: '100%', sm: 'auto' }}
            >
              Save changes
            </Button>
          </Group>
        </Stack>
      </form>
    </Stack>
  )
}
