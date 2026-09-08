import Link from 'next/link'
import { Badge, Box, Button, Card, Divider, Group, Progress, Stack, Text } from '@mantine/core'
import { ArrowRight, Building2, ChevronDown, Monitor, type LucideIcon } from 'lucide-react'
import type { AssessmentInstance } from '@/app/types/payload-types'
import type { RiskSummary } from '@/domain/assessments/computeRiskSummary'
import { formatDateTime } from '@/lib/format-date'

const statusMeta = {
  pending: ['Not started', 'gray'],
  in_progress: ['In progress', 'blue'],
  completed: ['Completed', 'green'],
  expired: ['Review due', 'orange'],
  superseded: ['Replaced', 'gray'],
} as const

export function SecurityReviewSummary({
  assessments,
  riskSummary,
}: {
  assessments: AssessmentInstance[]
  riskSummary?: RiskSummary
}) {
  const open = assessments.filter(item => ['pending', 'in_progress'].includes(item.status))
  const coverage = riskSummary?.evaluated_percentage ?? 0
  const applicable = riskSummary?.applicable_checks ?? 0
  const evaluated = Math.max(0, applicable - (riskSummary?.not_evaluable ?? 0))
  return (
    <Card withBorder radius="lg" p="lg">
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="xl">
        <Box style={{ flex: 1 }} miw={220}>
          <Group justify="space-between" mb="xs">
            <Text fw={700}>Evidence coverage</Text>
            <Text fw={750}>{coverage}%</Text>
          </Group>
          <Progress value={coverage} color="pine" radius="xl" />
          <Text size="sm" c="dimmed" mt="xs">
            {evaluated} of {applicable} current checks are evaluable. Missing, unknown or
            inconclusive information affects coverage, not risk.
          </Text>
        </Box>
        <Group gap="xl">
          <div>
            <Text size="xs" c="dimmed">
              Waiting
            </Text>
            <Text fz={28} fw={750}>
              {open.length}
            </Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">
              Risk
            </Text>
            <Text fz={28} fw={750}>
              {riskSummary?.risk_score ?? '—'}
            </Text>
          </div>
        </Group>
      </Group>
    </Card>
  )
}

export function SecurityReviewList({
  assessments,
  suffix = '',
}: {
  assessments: AssessmentInstance[]
  suffix?: string
}) {
  const groups = groupAssessments(assessments)
  const primary = groups.filter(group => group.scope !== 'asset')
  const devices = groups.filter(group => group.scope === 'asset')

  return (
    <Stack gap="xl">
      {primary.length > 0 && (
        <AssessmentSection
          title="Company and offices"
          description={`${primary.length} ${primary.length === 1 ? 'review' : 'reviews'} · company-wide and office routines`}
          icon={Building2}
          groups={primary}
          suffix={suffix}
          initiallyOpen
        />
      )}
      {devices.length > 0 && (
        <AssessmentSection
          title="Device reviews"
          description={`${devices.length} ${devices.length === 1 ? 'device' : 'devices'} · expand only when you need the detail`}
          icon={Monitor}
          groups={devices}
          suffix={suffix}
        />
      )}
      {!groups.length && (
        <Card withBorder p="xl" ta="center">
          <Text fw={600}>No reviews in this view</Text>
          <Text size="sm" c="dimmed">
            Try another status or assignment.
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
  initiallyOpen = false,
}: {
  title: string
  description: string
  icon: LucideIcon
  groups: AssessmentGroup[]
  suffix: string
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
          <AssessmentGroup key={group.key} group={group} suffix={suffix} divider={index > 0} />
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
          : 'Company'
        : item.scope === 'office'
          ? item.office && typeof item.office === 'object'
            ? item.office.name
            : 'Office'
          : item.manual_asset && typeof item.manual_asset === 'object'
            ? item.manual_asset.alias || 'Computer'
            : item.asset && typeof item.asset === 'object'
              ? item.asset.alias || item.asset.hostname || item.asset.ip || 'Device'
              : 'Device'
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
  divider,
}: {
  group: AssessmentGroup
  suffix: string
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
              ? 'Company-wide review'
              : group.scope === 'office'
                ? 'Office review'
                : 'Device review'}{' '}
            · {group.cycles.length} {group.cycles.length === 1 ? 'cycle' : 'cycles'}
          </Text>
        </div>
        <Button
          component={Link}
          href={'/portal/security-review/' + latest.id + suffix}
          variant="subtle"
          rightSection={<ArrowRight size={16} />}
        >
          Open current
        </Button>
      </Group>
      {group.cycles.length > 1 && (
        <Box mt="sm" style={{ overflowX: 'auto' }}>
          <Group gap="xs" wrap="nowrap">
            <Text size="xs" c="dimmed" fw={650} mr={4} style={{ whiteSpace: 'nowrap' }}>
              History
            </Text>
            {group.cycles.slice(1, 3).map((cycle, index) => (
              <Badge
                key={cycle.id}
                variant="outline"
                color="gray"
                radius="sm"
                style={{ whiteSpace: 'nowrap' }}
              >
                Cycle {group.cycles.length - index - 1} · {formatDateTime(cycle.opened_at)}
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
