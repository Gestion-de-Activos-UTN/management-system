'use client'

import { Badge, Button, Center, Drawer, Group, Loader, Stack, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowRight, History, RefreshCw } from 'lucide-react'
import { BackButton } from '@/components/ui/BackButton'
import { PageHeader } from '@/components/ui/PageHeader'
import { useAssessment } from '@/modules/assessments/hooks/use-assessment'
import { useAssessmentActions } from '@/modules/assessments/hooks/use-assessment-actions'
import { AssessmentForm } from '@/modules/assessments/components/AssessmentForm'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'
import { relationId } from '@/lib/relationId'
import { formatDateTime } from '@/lib/format-date'

export default function AssessmentDetailPage() {
  const [historyOpened, { open: openHistory, close: closeHistory }] = useDisclosure(false)
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const params = useSearchParams()
  const asOrganization = params.get('asOrganization') ?? undefined
  const detail = useAssessment(id, asOrganization)
  const actions = useAssessmentActions(id)
  const tenant = useTenantContext(asOrganization)
  const suffix = asOrganization ? '?asOrganization=' + asOrganization : ''

  if (detail.isPending || tenant.isPending)
    return (
      <Center py="xl">
        <Loader color="pine" />
      </Center>
    )
  if (!detail.data || detail.isError) return <Text c="red">Could not load this review.</Text>
  const data = detail.data
  const readOnly =
    data.assessment.status === 'completed' ||
    data.assessment.status === 'expired' ||
    data.assessment.status === 'superseded' ||
    Boolean(tenant.data?.isPlatformAdmin)
  const canStartNewCycle =
    tenant.data?.role === 'org_admin' ||
    (tenant.data?.role === 'office_manager' &&
      data.assessment.scope !== 'organization' &&
      Boolean(
        data.assessment.office && tenant.data.officeIds.includes(relationId(data.assessment.office))
      ))
  const history = data.assessment_history ?? [data.assessment]
  const isLatestCycle = String(history[0]?.id) === String(data.assessment.id)
  const currentCycleNumber =
    history.length - history.findIndex(cycle => String(cycle.id) === String(data.assessment.id))

  return (
    <Stack gap="lg">
      <BackButton href={'/portal/security-review' + suffix} label="Back to Security Review" />
      <PageHeader
        title="Review everyday security routines"
        description="Choose Yes only when the routine is followed consistently. If it happens only sometimes, choose No."
      />
      {(history.length > 1 || data.assessment.status === 'completed') && (
        <Group justify="space-between" gap="md" wrap="wrap">
          <Text size="sm" c="dimmed">
            {!isLatestCycle
              ? `Viewing historical cycle ${currentCycleNumber} of ${history.length}`
              : data.assessment.status === 'completed'
                ? 'Completed cycle · kept as history'
                : `Cycle ${currentCycleNumber} of ${history.length}`}
          </Text>
          <Group gap="xs">
            {history.length > 1 && (
              <Button variant="default" leftSection={<History size={16} />} onClick={openHistory}>
                View history
              </Button>
            )}
            {!isLatestCycle && history[0] && (
              <Button
                component={Link}
                href={`/portal/security-review/${history[0].id}${suffix}`}
                color="pine"
                rightSection={<ArrowRight size={16} />}
              >
                Back to latest
              </Button>
            )}
            {data.assessment.status === 'completed' && isLatestCycle && canStartNewCycle && (
              <Button
                variant="light"
                color="pine"
                leftSection={<RefreshCw size={16} />}
                loading={actions.startNewCycle.isPending}
                onClick={() =>
                  actions.startNewCycle.mutate('Requested from completed review', {
                    onSuccess: result => {
                      if (result.id) router.push(`/portal/security-review/${result.id}${suffix}`)
                    },
                  })
                }
              >
                Start new review cycle
              </Button>
            )}
          </Group>
        </Group>
      )}
      <Drawer
        opened={historyOpened}
        onClose={closeHistory}
        position="right"
        title="Review history"
        size="md"
      >
        <Stack gap="xs">
          {history.map((cycle, index) => {
            const current = String(cycle.id) === String(data.assessment.id)
            return (
              <Button
                key={cycle.id}
                component={Link}
                href={`/portal/security-review/${cycle.id}${suffix}`}
                onClick={closeHistory}
                variant={current ? 'light' : 'subtle'}
                color={current ? 'pine' : 'gray'}
                fullWidth
                h="auto"
                py="sm"
                justify="space-between"
                rightSection={
                  <Badge color={statusColor(cycle.status)} variant="light" size="sm">
                    {statusLabel(cycle.status)}
                  </Badge>
                }
              >
                <Stack gap={2} align="flex-start">
                  <Text size="sm" fw={700}>
                    Cycle {history.length - index}
                    {current ? ' · Viewing' : ''}
                  </Text>
                  <Text size="xs" c="dimmed" fw={400}>
                    Started {formatDateTime(cycle.opened_at)}
                  </Text>
                </Stack>
              </Button>
            )
          })}
        </Stack>
      </Drawer>
      {data.assessment.status !== 'completed' && (data.previous_answers?.length ?? 0) > 0 && (
        <Text size="sm" c="pine.8" fw={600}>
          Previous answers loaded · review them before completing this cycle
        </Text>
      )}
      <AssessmentForm
        assessment={data.assessment}
        savedAnswers={data.answers}
        previousAnswers={data.previous_answers ?? []}
        effectiveEvidence={data.effective_evidence ?? {}}
        technicalObservations={data.technical_observations ?? []}
        readOnly={readOnly}
        saving={actions.saveDraft.isPending}
        completing={actions.complete.isPending}
        onSave={command => actions.saveDraft.mutate(command)}
        onComplete={command => actions.complete.mutate(command)}
      />
    </Stack>
  )
}

const statusLabel = (status: string) =>
  status === 'pending'
    ? 'Not started'
    : status === 'in_progress'
      ? 'In progress'
      : status === 'completed'
        ? 'Completed'
        : status === 'expired'
          ? 'Review due'
          : 'Replaced'

const statusColor = (status: string) =>
  status === 'completed'
    ? 'green'
    : status === 'in_progress'
      ? 'blue'
      : status === 'expired'
        ? 'orange'
        : 'gray'
