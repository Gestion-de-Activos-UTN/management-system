import Link from 'next/link'
import {
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Progress,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core'
import { ArrowRight, Building2, ChevronDown, Info, Monitor, type LucideIcon } from 'lucide-react'
import type { AssessmentInstance } from '@/app/types/payload-types'
import type { SecurityReviewSummary as SecurityReviewSummaryData } from '@/modules/assessments/service'
import { formatDateTime } from '@/lib/format-date'
import { RISK_BAND_LABEL } from '@/lib/enum-labels'
import { RISK_BAND_COLOR, RISK_SCORE_SCALE } from '@/modules/risk/risk-labels'
import { CreateRelatedTaskButton } from '@/modules/tasks/components/CreateRelatedTaskButton'

const statusMeta = {
  pending: ['Sin iniciar', 'gray'],
  in_progress: ['En curso', 'blue'],
  completed: ['Completada', 'green'],
  expired: ['Revisión vencida', 'orange'],
  superseded: ['Reemplazada', 'gray'],
} as const

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
            control revisado en un equipo). Respondé las revisiones pendientes o identificá los
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
                  <Badge color={RISK_BAND_COLOR[band]}>{RISK_BAND_LABEL[band]}</Badge>
                ) : (
                  <Tooltip label="La cobertura es baja: el valor es orientativo y todavía no se clasifica.">
                    <Badge color="gray" variant="light">
                      Preliminar
                    </Badge>
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

export function SecurityReviewList({
  assessments,
  suffix = '',
  asOrganization,
}: {
  assessments: AssessmentInstance[]
  suffix?: string
  asOrganization?: string
}) {
  const groups = groupAssessments(assessments)
  const primary = groups.filter(group => group.scope !== 'asset')
  const devices = groups.filter(group => group.scope === 'asset')

  return (
    <Stack gap="xl">
      {primary.length > 0 && (
        <AssessmentSection
          title="Empresa y oficinas"
          description={`${primary.length} ${primary.length === 1 ? 'revisión' : 'revisiones'} · rutinas de toda la empresa y de las oficinas`}
          icon={Building2}
          groups={primary}
          suffix={suffix}
          asOrganization={asOrganization}
          initiallyOpen
        />
      )}
      {devices.length > 0 && (
        <AssessmentSection
          title="Revisiones de dispositivos"
          description={`${devices.length} ${devices.length === 1 ? 'dispositivo' : 'dispositivos'} · expande solo cuando necesites el detalle`}
          icon={Monitor}
          groups={devices}
          suffix={suffix}
          asOrganization={asOrganization}
        />
      )}
      {!groups.length && (
        <Card withBorder p="xl" ta="center">
          <Text fw={600}>No hay revisiones en esta vista</Text>
          <Text size="sm" c="dimmed">
            Prueba con otro estado o asignación.
          </Text>
        </Card>
      )}
    </Stack>
  )
}

function AssessmentSection({
  title,
  description,
  icon: Icon,
  groups,
  suffix,
  asOrganization,
  initiallyOpen = false,
}: {
  title: string
  description: string
  icon: LucideIcon
  groups: AssessmentGroup[]
  suffix: string
  asOrganization?: string
  initiallyOpen?: boolean
}) {
  return (
    <Card component="details" open={initiallyOpen || undefined} withBorder radius="lg" p="md">
      <Box component="summary" style={{ cursor: 'pointer', listStyle: 'none' }}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Icon size={18} />
            <div>
              <Text fw={750}>{title}</Text>
              <Text size="sm" c="dimmed">
                {description}
              </Text>
            </div>
          </Group>
          <ChevronDown size={18} />
        </Group>
      </Box>
      <Stack gap={0} mt="md">
        {groups.map((group, index) => (
          <AssessmentGroup
            key={group.key}
            group={group}
            suffix={suffix}
            asOrganization={asOrganization}
            divider={index > 0}
          />
        ))}
      </Stack>
    </Card>
  )
}

type AssessmentGroup = {
  key: string
  target: string
  scope: AssessmentInstance['scope']
  cycles: AssessmentInstance[]
  manuallyEntered: boolean
}

function groupAssessments(assessments: AssessmentInstance[]): AssessmentGroup[] {
  const groups = new Map<string, AssessmentGroup>()
  for (const item of assessments) {
    const relation =
      item.scope === 'organization'
        ? 'organization'
        : item.scope === 'office'
          ? String(item.office && typeof item.office === 'object' ? item.office.id : item.office)
          : item.manual_asset
            ? `manual:${String(
                typeof item.manual_asset === 'object' ? item.manual_asset.id : item.manual_asset
              )}`
            : String(item.asset && typeof item.asset === 'object' ? item.asset.id : item.asset)
    const key = `${item.scope}:${relation}`
    const target =
      item.scope === 'organization'
        ? item.organization && typeof item.organization === 'object'
          ? item.organization.name
          : 'Empresa'
        : item.scope === 'office'
          ? item.office && typeof item.office === 'object'
            ? item.office.name
            : 'Oficina'
          : item.manual_asset && typeof item.manual_asset === 'object'
            ? item.manual_asset.alias || 'Computadora'
            : item.asset && typeof item.asset === 'object'
              ? item.asset.alias || item.asset.hostname || item.asset.ip || 'Dispositivo'
              : 'Dispositivo'
    const group = groups.get(key) ?? {
      key,
      target,
      scope: item.scope,
      cycles: [],
      manuallyEntered: Boolean(item.manual_asset),
    }
    group.cycles.push(item)
    groups.set(key, group)
  }
  return [...groups.values()].map(group => ({
    ...group,
    cycles: group.cycles.sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
    ),
  }))
}

function AssessmentGroup({
  group,
  suffix,
  asOrganization,
  divider,
}: {
  group: AssessmentGroup
  suffix: string
  asOrganization?: string
  divider: boolean
}) {
  const latest = group.cycles[0]
  const [label, color] = statusMeta[latest.status]
  return (
    <Box py="sm">
      {divider && <Divider mb="md" />}
      <Group justify="space-between" align="center" wrap="wrap">
        <div>
          <Group gap="xs">
            <Text fw={650}>{group.target}</Text>
            <Badge color={color} variant="light">
              {label}
            </Badge>
            {group.manuallyEntered && (
              <Badge color="gray" variant="light">
                Manual
              </Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed">
            {group.scope === 'organization'
              ? 'Revisión de toda la empresa'
              : group.scope === 'office'
                ? 'Revisión de oficina'
                : 'Revisión de dispositivo'}{' '}
            · {group.cycles.length} {group.cycles.length === 1 ? 'cycle' : 'cycles'}
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
            href={'/portal/security-review/' + latest.id + suffix}
            variant="subtle"
            rightSection={<ArrowRight size={16} />}
          >
            Abrir actual
          </Button>
        </Group>
      </Group>
      {group.cycles.length > 1 && (
        <Box mt="sm" style={{ overflowX: 'auto' }}>
          <Group gap="xs" wrap="nowrap">
            <Text size="xs" c="dimmed" fw={650} mr={4} style={{ whiteSpace: 'nowrap' }}>
              Historial
            </Text>
            {group.cycles.slice(1, 3).map((cycle, index) => (
              <Badge
                key={cycle.id}
                variant="outline"
                color="gray"
                radius="sm"
                style={{ whiteSpace: 'nowrap' }}
              >
                Ciclo {group.cycles.length - index - 1} · {formatDateTime(cycle.opened_at)}
              </Badge>
            ))}
            {group.cycles.length > 3 && (
              <Badge variant="outline" color="gray" radius="sm">
                …
              </Badge>
            )}
          </Group>
        </Box>
      )}
    </Box>
  )
}
