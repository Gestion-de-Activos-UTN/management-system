'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
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
  ThemeIcon,
  Tooltip,
} from '@mantine/core'
import { PageHeader } from '@/components/ui/PageHeader'
import { TechnicalText } from '@/components/ui/TechnicalText'
import { useOrgMembers } from '@/modules/users/hooks/use-org-members'
import { CRITICALITY_OPTIONS, MANUAL_ASSET_STATUS_OPTIONS } from '@/lib/enum-labels'
import { formatDateTime } from '@/lib/format-date'
import type { Asset } from '@/app/types/payload-types'
import {
  AssetBusinessFieldsSchema,
  type AssetBusinessFields,
  UNKNOWN_IDENTIFICATION_VALUE,
} from '../schema'
import { useUpdateAsset } from '../hooks/use-update-asset'
import { useUnidentifyAsset } from '../hooks/use-unidentify-asset'
import { useMarkAssetViewed } from '../hooks/use-mark-asset-viewed'
import { useMarkAssetChangesViewed } from '../hooks/use-mark-asset-changes-viewed'
import { BadgeCheck, Fingerprint, Lock, Network, ScanSearch, Undo2 } from 'lucide-react'
import { AssetIdentificationModal } from './AssetIdentificationModal'
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

function TechnicalContentRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(110px, 0.42fr) minmax(0, 1fr)',
        alignItems: 'start',
        gap: 'var(--mantine-spacing-sm)',
      }}
    >
      <Text size="xs" c="dimmed" fw={500} pt={2}>
        {label}
      </Text>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  )
}

function TechnicalRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <TechnicalContentRow label={label}>
      <TechnicalText style={{ textAlign: 'left', overflowWrap: 'anywhere' }}>
        {value || '—'}
      </TechnicalText>
    </TechnicalContentRow>
  )
}

function TechnicalSection({
  title,
  description,
  icon,
  children,
}: {
  title: string
  description: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <Card withBorder padding="lg" radius="md">
      <Stack gap="md">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon variant="light" color="pine" radius="md" size={38}>
            {icon}
          </ThemeIcon>
          <div>
            <Text fw={650}>{title}</Text>
            <Text size="xs" c="dimmed">
              {description}
            </Text>
          </div>
        </Group>
        <Divider />
        <Stack gap="sm">{children}</Stack>
      </Stack>
    </Card>
  )
}

const COVERAGE_LABELS = {
  complete: 'Complete',
  partial: 'Partial',
  not_attempted: 'Not attempted',
  unknown: 'Unknown',
} as const

function coverageColor(status: string | null | undefined): string {
  if (status === 'complete') return 'green'
  if (status === 'partial') return 'yellow'
  return 'gray'
}

function CoverageRow({ coverage }: { coverage: Asset['asset_coverage'] }) {
  const items = [
    ['Ports', coverage?.port_scan],
    ['Services', coverage?.service_detection],
    ['Operating system', coverage?.os_detection],
    ['Names', coverage?.name_resolution],
  ] as const

  return (
    <TechnicalContentRow label="Scan coverage">
      <Group gap={6} wrap="wrap">
        {items.map(([label, status]) => (
          <Badge key={label} variant="light" color={coverageColor(status)} size="sm" tt="none">
            {label} · {COVERAGE_LABELS[status ?? 'unknown']}
          </Badge>
        ))}
      </Group>
    </TechnicalContentRow>
  )
}

function ObservedNamesRow({ names }: { names: Asset['names'] }) {
  return (
    <TechnicalContentRow label="Observed names">
      {(names ?? []).length > 0 ? (
        <Group gap={6} wrap="wrap">
          {(names ?? []).map((name, index) => (
            <Badge
              key={name.id ?? `${name.value}-${index}`}
              variant="outline"
              color="gray"
              tt="none"
            >
              {name.value} · {name.source.toUpperCase()}
            </Badge>
          ))}
        </Group>
      ) : (
        <Text size="sm" c="dimmed">
          No names observed
        </Text>
      )}
    </TechnicalContentRow>
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
      <List
        size="sm"
        spacing={2}
        style={{ flex: '1 1 220px', textAlign: 'right' }}
        listStyleType="none"
      >
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
  return `${service.port ?? '?'}/${service.protocol ?? '?'} · ${service.state ?? 'unknown'}`
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

// `services` contiene observaciones de Nmap, incluidas las ambiguas o filtradas; solo `open`
// participa como señal positiva en la inferencia. Chips compactos en vez de una lista
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
          No port observations
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
        title={`Observed ports (${list.length})`}
        size="lg"
        centered
      >
        <Table.ScrollContainer minWidth={860}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Port</Table.Th>
                <Table.Th>Protocol</Table.Th>
                <Table.Th>State</Table.Th>
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
                    <Table.Td>{service.state ?? 'unknown'}</Table.Td>
                    <Table.Td>{serviceDescription(service)}</Table.Td>
                    <Table.Td>{service.version || '—'}</Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <Badge
                          variant={service.detection_method === 'probed' ? 'filled' : 'outline'}
                          color="pine"
                          size="sm"
                        >
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
                          <TechnicalText style={{ whiteSpace: 'pre-wrap' }}>
                            {scripts}
                          </TechnicalText>
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
  const unidentifyAsset = useUnidentifyAsset()
  const markViewed = useMarkAssetViewed(asset.id)
  const markChangesViewed = useMarkAssetChangesViewed(asset.id)
  const [identificationOpen, setIdentificationOpen] = useState(false)
  const [unidentifyConfirmOpen, setUnidentifyConfirmOpen] = useState(false)

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
    if (
      asset.technical_changed_at != null &&
      lastMarkedChangedAt.current !== asset.technical_changed_at
    ) {
      lastMarkedChangedAt.current = asset.technical_changed_at
      markChangesViewed.mutate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.id, asset.technical_changed_at])

  const {
    control,
    handleSubmit,
    reset,
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

  // `defaultValues` se fija una sola vez al montar y no se resincroniza sola si `asset` cambia
  // después (ej. el modal de identificación guarda, o llega un re-scan mientras la página está
  // abierta). Resincronizamos a mano, pero solo cuando el usuario no tiene ediciones sin guardar
  // (`!isDirty`) para no pisar un cambio en progreso.
  useEffect(() => {
    if (isDirty) return
    reset({
      alias: asset.alias ?? null,
      criticality: asset.criticality ?? null,
      owner: typeof asset.owner === 'string' ? asset.owner : (asset.owner?.id ?? null),
      location: asset.location ?? null,
      status: asset.status ?? 'active',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.alias, asset.criticality, asset.owner, asset.location, asset.status])

  // Solo los campos que el usuario tocó, nunca el objeto completo: mandar todo el formulario
  // reenviaría un `status` (u otro campo de negocio) desactualizado y pisaría en silencio un
  // cambio hecho por otro lado (bug reportado: un asset retirado volvía a "active" al guardar
  // un edit no relacionado).
  const onSubmit = handleSubmit(data => {
    const dirtyKeys = Object.keys(dirtyFields) as Array<keyof AssetBusinessFields>
    if (dirtyKeys.length === 0) return
    const changed = Object.fromEntries(
      dirtyKeys.map(key => [key, data[key]])
    ) as Partial<AssetBusinessFields>
    updateAsset.mutate(changed)
  })

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <PageHeader
          title={asset.hostname || asset.alias || asset.ip || asset.asset_id}
          description="Read-only technical block (discovered by the scanner) plus editable business fields."
        />
        {asset.identification_status !== 'confirmed' && (
          <Button
            variant="filled"
            color="pine"
            leftSection={<BadgeCheck size={16} strokeWidth={1.5} />}
            onClick={() => setIdentificationOpen(true)}
            w={{ base: '100%', sm: 'auto' }}
          >
            Identify asset
          </Button>
        )}
        {asset.identification_status === 'confirmed' && (
          <Button
            variant="subtle"
            color="red"
            leftSection={<Undo2 size={16} strokeWidth={1.5} />}
            onClick={() => setUnidentifyConfirmOpen(true)}
            w={{ base: '100%', sm: 'auto' }}
          >
            Remove identification
          </Button>
        )}
      </Group>

      <AssetIdentificationModal
        asset={asset}
        members={members ?? []}
        opened={identificationOpen}
        onClose={() => setIdentificationOpen(false)}
      />

      <Modal
        opened={unidentifyConfirmOpen}
        onClose={() => setUnidentifyConfirmOpen(false)}
        title="Remove identification"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            This asset will go back to &quot;not identified&quot;. Owner, criticality, alias and
            location stay saved (so they prepopulate if you identify it again), but they will stop
            counting in risk calculations until then.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setUnidentifyConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              color="red"
              loading={unidentifyAsset.isPending}
              onClick={() =>
                unidentifyAsset.mutate(
                  { id: asset.id },
                  { onSuccess: () => setUnidentifyConfirmOpen(false) }
                )
              }
            >
              Remove identification
            </Button>
          </Group>
        </Stack>
      </Modal>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <TechnicalSection
          title="Identity"
          description="Identifiers and names observed on the network"
          icon={<Fingerprint size={20} strokeWidth={1.7} />}
        >
          <TechnicalRow label="Asset ID" value={asset.asset_id} />
          <TechnicalRow label="Hostname" value={asset.hostname} />
          <ObservedNamesRow names={asset.names} />
          <TechnicalRow label="Vendor" value={asset.vendor} />
          <TechnicalRow label="MAC type" value={asset.mac_metadata?.kind?.replaceAll('_', ' ')} />
        </TechnicalSection>

        <TechnicalSection
          title="Network position"
          description="Addressing, route context and scanner relationship"
          icon={<Network size={20} strokeWidth={1.7} />}
        >
          <TechnicalRow label="IP address" value={asset.ip} />
          <TechnicalRow label="MAC address" value={asset.mac} />
          <TechnicalRow label="Discovery reason" value={asset.state_reason} />
          <TechnicalRow label="Gateway IP" value={asset.gateway_ip} />
          <TechnicalRow label="Gateway MAC" value={asset.gateway_mac} />
          <TechnicalContentRow label="Scanner host">
            <Badge
              variant="light"
              tt="none"
              color={
                asset.is_scanner_host
                  ? 'pine'
                  : asset.scanner_host_match === 'conflict'
                    ? 'red'
                    : 'gray'
              }
            >
              {asset.is_scanner_host
                ? `Detected · ${asset.scanner_host_match ?? 'unknown'}`
                : asset.scanner_host_match === 'conflict'
                  ? 'Conflicting evidence'
                  : 'Not detected'}
            </Badge>
          </TechnicalContentRow>
        </TechnicalSection>
      </SimpleGrid>

      <TechnicalSection
        title="Scan observations"
        description="What the latest scan could inspect and how complete the result is"
        icon={<ScanSearch size={20} strokeWidth={1.7} />}
      >
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
        <CoverageRow coverage={asset.asset_coverage} />
        {(asset.scan_issues ?? []).length > 0 ? (
          <Alert color="yellow" variant="light" title="Scan limitations">
            <Group gap={6} wrap="wrap">
              {(asset.scan_issues ?? []).map((issue, index) => (
                <Badge
                  key={issue.id ?? `${issue.stage}-${issue.code}-${index}`}
                  color="yellow"
                  tt="none"
                >
                  {issue.stage} · {issue.code.replaceAll('_', ' ')}
                </Badge>
              ))}
            </Group>
          </Alert>
        ) : (
          <Text size="sm" c="dimmed">
            No scan limitations reported.
          </Text>
        )}
        <Divider />
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
      </TechnicalSection>

      <IdentificationHelpCard asset={asset} />

      <Divider label="Business data" />

      {asset.identification_status !== 'confirmed' && (
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
                  disabled={asset.identification_status !== 'confirmed'}
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
                  data={[
                    { value: UNKNOWN_IDENTIFICATION_VALUE, label: 'Not yet assessed' },
                    ...CRITICALITY_OPTIONS,
                  ]}
                  disabled={asset.identification_status !== 'confirmed'}
                  value={field.value ?? UNKNOWN_IDENTIFICATION_VALUE}
                  onChange={value =>
                    field.onChange(value === UNKNOWN_IDENTIFICATION_VALUE ? null : value)
                  }
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
                  data={[
                    { value: UNKNOWN_IDENTIFICATION_VALUE, label: 'Unassigned or unknown' },
                    ...(members ?? []).map(m => ({
                      value: m.id,
                      label: m.name || m.email,
                    })),
                  ]}
                  disabled={asset.identification_status !== 'confirmed'}
                  value={field.value ?? UNKNOWN_IDENTIFICATION_VALUE}
                  onChange={value =>
                    field.onChange(value === UNKNOWN_IDENTIFICATION_VALUE ? null : value)
                  }
                  searchable
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
                  disabled={asset.identification_status !== 'confirmed'}
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
