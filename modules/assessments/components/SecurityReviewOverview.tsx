import { matchesSearch } from '@/lib/search-text'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Anchor,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Progress,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { ArrowRight, Building2, Info, Monitor, Search, type LucideIcon } from 'lucide-react'
import type { AssessmentInstance } from '@/app/types/payload-types'
import type { SecurityReviewSummary as SecurityReviewSummaryData } from '@/modules/assessments/service'
import { formatDate } from '@/lib/format-date'
import { portalHref } from '@/lib/portal-href'
import { RISK_SCORE_SCALE } from '@/modules/risk/risk-labels'
import { RiskBandBadge } from '@/modules/risk/components/RiskBandBadge'
import { CreateRelatedTaskButton } from '@/modules/tasks/components/CreateRelatedTaskButton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ASSESSMENT_STATUS_LABEL, ASSESSMENT_STATUS_TONE } from '../assessment-labels'
import { groupAssessments, type AssessmentGroup } from '../assessment-groups'
import { getDeviceReviewColumns } from '../assessments.columns'
import { DataTable } from '@/components/ui/DataTable'

export function SecurityReviewSummary({
  assessments,
  riskSummary,
  riskHref,
}: {
  assessments: AssessmentInstance[]
  riskSummary?: SecurityReviewSummaryData
  riskHref: string
}) {
  const open = assessments.filter(item => ['pending', 'in_progress'].includes(item.status))
  const coverage = riskSummary?.evaluated_percentage ?? 0
  const applicable = riskSummary?.applicable_checks ?? 0
  const evaluated = Math.max(0, applicable - (riskSummary?.not_evaluable ?? 0))
  const score = riskSummary?.risk_score ?? null
  const band = riskSummary?.risk_band ?? null
  return (
    <Card withBorder radius="lg" p="lg">
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="xl">
        <Box style={{ flex: 1 }} miw={220}>
          <Group justify="space-between" mb="xs">
            <Group gap={6}>
              <Text fw={700}>Cobertura de evidencia</Text>
              <Tooltip
                multiline
                w={280}
                label="Cuánto de lo que corresponde revisar tiene información vigente. Los equipos más importantes para el negocio pesan más."
              >
                <Info size={14} aria-label="Qué es la cobertura" />
              </Tooltip>
            </Group>
            <Text fw={750}>{Math.round(coverage)}%</Text>
          </Group>
          <Progress value={coverage} color="pine" radius="xl" />
          <Text size="sm" c="dimmed" mt="xs">
            Hay información vigente para {evaluated} de {applicable} comprobaciones (cada una es un
            control revisado en un equipo). Responde las revisiones pendientes o identifica los
            equipos nuevos para subirla; la información faltante no aumenta el riesgo.
          </Text>
        </Box>
        <Group gap="xl" align="flex-start">
          <Stat
            label="Revisiones por responder"
            value={open.length}
            hint="Revisiones sin completar en esta vista."
          />
          <Stat
            label="Equipos excluidos"
            value={riskSummary?.excluded_assets ?? 0}
            hint="Excluidos temporalmente de las preguntas; los controles automáticos siguen corriendo."
          />
          <div>
            <Text size="xs" c="dimmed">
              Riesgo sin tratar
            </Text>
            <Group gap={6} align="baseline">
              <Text fz={28} fw={750}>
                {score === null ? '—' : `${Math.round(score)} %`}
              </Text>
              {score !== null &&
                (band ? (
                  <RiskBandBadge band={band} />
                ) : (
                  <Tooltip label="La cobertura es baja: el valor es orientativo y todavía no se clasifica.">
                    <StatusBadge tone="neutral" label="Preliminar" />
                  </Tooltip>
                ))}
            </Group>
            <Text size="xs" c="dimmed" maw={220}>
              {score === null ? 'Falta información para calcularlo.' : RISK_SCORE_SCALE}
            </Text>
            <Anchor component={Link} href={riskHref} size="xs">
              Ver detalle del riesgo
            </Anchor>
          </div>
        </Group>
      </Group>
    </Card>
  )
}

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <Tooltip multiline w={240} label={hint}>
      <div>
        <Text size="xs" c="dimmed">
          {label}
        </Text>
        <Text fz={28} fw={750}>
          {value}
        </Text>
      </div>
    </Tooltip>
  )
}

/** Ancla de la sección de dispositivos: volver desde la revisión de un dispositivo baja hasta acá. */
export const DEVICES_ANCHOR = 'dispositivos'

export function SecurityReviewList({
  assessments,
  asOrganization,
}: {
  assessments: AssessmentInstance[]
  asOrganization?: string
}) {
  const [search, setSearch] = useState('')
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const device = params.get('device')
  // Risk references and review groups keep detected and legacy manual IDs distinct.
  const focusedKey = device?.startsWith('manual:') ? `asset:${device}` : device
  const groups = groupAssessments(assessments)
  const primary = groups.filter(group => group.scope !== 'asset')
  const devices = groups.filter(group => group.scope === 'asset')
  const term = search.trim()
  const visibleDevices = devices.filter(
    group =>
      (!focusedKey || group.key === focusedKey) && (!term || matchesSearch([group.target], term))
  )
  const columns = useMemo(() => getDeviceReviewColumns(asOrganization), [asOrganization])
  const devicesRef = useRef<HTMLDivElement>(null)

  // La lista se monta cuando llegan los datos, después de la navegación: el salto nativo al
  // ancla ya pasó y no encontró la sección, así que se hace acá.
  useEffect(() => {
    if (device || window.location.hash === `#${DEVICES_ANCHOR}`)
      devicesRef.current?.scrollIntoView()
  }, [device])

  return (
    <Stack gap="xl">
      <Stack gap="sm">
        <SectionTitle
          icon={Building2}
          title={`Empresa y oficinas (${primary.length})`}
          description="Rutinas de toda la empresa y de cada oficina."
        />
        {primary.length ? (
          <Card withBorder radius="lg" p="md">
            <Stack gap={0}>
              {primary.map((group, index) => (
                <AssessmentGroup
                  key={group.key}
                  group={group}
                  asOrganization={asOrganization}
                  divider={index > 0}
                />
              ))}
            </Stack>
          </Card>
        ) : (
          <EmptyReviews />
        )}
      </Stack>
      <Stack
        gap="sm"
        id={DEVICES_ANCHOR}
        ref={devicesRef}
        style={{ scrollMarginTop: 'calc(var(--app-shell-header-height, 0px) + 16px)' }}
      >
        <Group justify="space-between" align="flex-end" gap="sm">
          <SectionTitle
            icon={Monitor}
            title={`Dispositivos (${devices.length})`}
            description="Una revisión por equipo, detectado por el escáner o cargado a mano."
          />
          {devices.length > 0 && (
            <TextInput
              placeholder="Buscar dispositivo"
              aria-label="Buscar dispositivo"
              leftSection={<Search size={16} strokeWidth={1.5} />}
              value={search}
              onChange={event => setSearch(event.currentTarget.value)}
              w={{ base: '100%', sm: 260 }}
            />
          )}
        </Group>
        {device && (
          <Group justify="space-between" gap="xs">
            <Text size="sm">
              {devices.find(group => group.key === focusedKey)?.target ??
                'Dispositivo seleccionado'}
            </Text>
            <Button
              variant="subtle"
              size="compact-sm"
              onClick={() => {
                const next = new URLSearchParams(params.toString())
                next.delete('device')
                router.replace(`${pathname}${next.size ? `?${next}` : ''}#${DEVICES_ANCHOR}`, {
                  scroll: false,
                })
                setSearch('')
              }}
            >
              Ver todos los dispositivos
            </Button>
          </Group>
        )}
        {devices.length ? (
          <Card withBorder radius="lg" p="md">
            <DataTable
              columns={columns}
              data={visibleDevices}
              emptyLabel="Ningún dispositivo coincide con la búsqueda"
              minWidth={680}
            />
          </Card>
        ) : (
          <EmptyReviews />
        )}
      </Stack>
    </Stack>
  )
}

function SectionTitle({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon
  title: string
  description: string
}) {
  return (
    <Group gap="sm" wrap="nowrap" align="flex-start">
      <Icon size={18} strokeWidth={1.5} style={{ marginTop: 3 }} />
      <div>
        <Text fw={750}>{title}</Text>
        <Text size="sm" c="dimmed">
          {description}
        </Text>
      </div>
    </Group>
  )
}

function EmptyReviews() {
  return (
    <Card withBorder p="xl" ta="center">
      <Text fw={600}>No hay revisiones en esta vista</Text>
      <Text size="sm" c="dimmed">
        Prueba con otro estado o asignación.
      </Text>
    </Card>
  )
}

function AssessmentGroup({
  group,
  asOrganization,
  divider,
}: {
  group: AssessmentGroup
  asOrganization?: string
  divider: boolean
}) {
  const latest = group.cycles[0]
  return (
    <Box py="sm">
      {divider && <Divider mb="md" />}
      <Group justify="space-between" align="center" wrap="wrap">
        <div>
          <Group gap="xs">
            <Text fw={650}>{group.target}</Text>
            <StatusBadge
              tone={ASSESSMENT_STATUS_TONE[latest.status]}
              label={ASSESSMENT_STATUS_LABEL[latest.status]}
            />
            {group.manuallyEntered && <StatusBadge tone="neutral" label="Activo manual" />}
          </Group>
          {/* El historial completo de ciclos está en el detalle (Drawer "Historial de revisiones"). */}
          <Text size="xs" c="dimmed">
            {group.scope === 'organization'
              ? 'Revisión de toda la empresa'
              : group.scope === 'office'
                ? 'Revisión de oficina'
                : 'Revisión de dispositivo'}{' '}
            · Ciclo {group.cycles.length} · {formatDate(latest.opened_at)}
          </Text>
        </div>
        <Group gap="xs">
          <CreateRelatedTaskButton
            compact
            reference={{ relationTo: 'assessment-instances', value: String(latest.id) }}
            asOrganization={asOrganization}
          />
          <Button
            component={Link}
            href={portalHref(`/portal/security-review/${latest.id}`, asOrganization)}
            variant="subtle"
            rightSection={<ArrowRight size={16} />}
          >
            Abrir actual
          </Button>
        </Group>
      </Group>
    </Box>
  )
}
