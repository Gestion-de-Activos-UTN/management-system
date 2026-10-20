'use client'

import { Alert, Button, Center, Drawer, Group, Loader, Stack, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Archive, ArrowRight, History, RefreshCw } from 'lucide-react'
import { BackButton } from '@/components/ui/BackButton'
import { PageHeader } from '@/components/ui/PageHeader'
import { useAssessment } from '@/modules/assessments/hooks/use-assessment'
import { useAssessmentActions } from '@/modules/assessments/hooks/use-assessment-actions'
import { AssessmentForm } from '@/modules/assessments/components/AssessmentForm'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'
import { relationId } from '@/lib/relationId'
import { portalHref } from '@/lib/portal-href'
import { DEVICES_ANCHOR } from '@/modules/assessments/components/SecurityReviewOverview'
import { formatDateTime } from '@/lib/format-date'
import { CreateRelatedTaskButton } from '@/modules/tasks/components/CreateRelatedTaskButton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import {
  ASSESSMENT_STATUS_LABEL,
  ASSESSMENT_STATUS_TONE,
} from '@/modules/assessments/assessment-labels'

export default function AssessmentDetailPage() {
  const [historyOpened, { open: openHistory, close: closeHistory }] = useDisclosure(false)
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const params = useSearchParams()
  const asOrganization = params.get('asOrganization') ?? undefined
  const detail = useAssessment(id, asOrganization)
  const actions = useAssessmentActions(id)
  const tenant = useTenantContext(asOrganization)

  if (detail.isPending || tenant.isPending)
    return (
      <Center py="xl">
        <Loader color="pine" />
      </Center>
    )
  if (!detail.data || detail.isError) return <Text c="red">No se pudo cargar esta revisión.</Text>
  const data = detail.data
  const readOnly =
    data.assessment.status === 'completed' ||
    data.assessment.status === 'expired' ||
    data.assessment.status === 'superseded' ||
    Boolean(data.inactive_subject) ||
    Boolean(tenant.data?.isPlatformAdmin)
  const canStartNewCycle =
    !data.inactive_subject &&
    (tenant.data?.role === 'org_admin' ||
      (tenant.data?.role === 'office_manager' &&
        data.assessment.scope !== 'organization' &&
        Boolean(
          data.assessment.office &&
          tenant.data.officeIds.includes(relationId(data.assessment.office))
        )))
  const history = data.assessment_history ?? [data.assessment]
  const isLatestCycle = String(history[0]?.id) === String(data.assessment.id)
  const currentCycleNumber =
    history.length - history.findIndex(cycle => String(cycle.id) === String(data.assessment.id))
  // Volver a la lista a la altura de la sección de dispositivos si la revisión es de uno.
  const listHref = `${portalHref('/portal/security-review', asOrganization)}${
    data.assessment.scope === 'asset' ? `#${DEVICES_ANCHOR}` : ''
  }`

  return (
    <Stack gap="lg">
      <BackButton href={listHref} label="Volver a Revisión de seguridad" />
      <PageHeader
        title="Revisa las rutinas cotidianas de seguridad"
        badge={
          <StatusBadge
            tone={ASSESSMENT_STATUS_TONE[data.assessment.status]}
            label={ASSESSMENT_STATUS_LABEL[data.assessment.status]}
          />
        }
        description="Elige Sí solo cuando la rutina se cumpla de forma constante. Si se cumple solo algunas veces, elige No."
        rightSection={
          <CreateRelatedTaskButton
            reference={{ relationTo: 'assessment-instances', value: String(data.assessment.id) }}
            asOrganization={asOrganization}
          />
        }
      />
      {data.inactive_subject && (
        <Alert color="gray" icon={<Archive size={16} strokeWidth={1.5} />}>
          {data.inactive_subject === 'office_inactive'
            ? 'La oficina está inactiva: esta revisión se conserva solo como historial.'
            : 'La organización está inactiva: esta revisión se conserva solo como historial.'}
        </Alert>
      )}
      {(history.length > 1 || data.assessment.status === 'completed') && (
        <Group justify="space-between" gap="md" wrap="wrap">
          <Text size="sm" c="dimmed">
            {!isLatestCycle
              ? `Viendo el ciclo histórico ${currentCycleNumber} de ${history.length}`
              : data.assessment.status === 'completed'
                ? 'Ciclo completado · conservado en el historial'
                : `Ciclo ${currentCycleNumber} de ${history.length}`}
          </Text>
          <Group gap="xs">
            {history.length > 1 && (
              <Button variant="default" leftSection={<History size={16} />} onClick={openHistory}>
                Ver historial
              </Button>
            )}
            {!isLatestCycle && history[0] && (
              <Button
                component={Link}
                href={portalHref(`/portal/security-review/${history[0].id}`, asOrganization)}
                color="pine"
                rightSection={<ArrowRight size={16} />}
              >
                Volver a la última
              </Button>
            )}
            {data.assessment.status === 'completed' && isLatestCycle && canStartNewCycle && (
              <Button
                variant="light"
                color="pine"
                leftSection={<RefreshCw size={16} />}
                loading={actions.startNewCycle.isPending}
                onClick={() =>
                  actions.startNewCycle.mutate('Solicitado desde una revisión completada', {
                    onSuccess: result => {
                      if (result.id)
                        router.push(
                          portalHref(`/portal/security-review/${result.id}`, asOrganization)
                        )
                    },
                  })
                }
              >
                Iniciar nuevo ciclo de revisión
              </Button>
            )}
          </Group>
        </Group>
      )}
      <Drawer
        opened={historyOpened}
        onClose={closeHistory}
        position="right"
        title="Historial de revisiones"
        size="md"
      >
        <Stack gap="xs">
          {history.map((cycle, index) => {
            const current = String(cycle.id) === String(data.assessment.id)
            return (
              <Button
                key={cycle.id}
                component={Link}
                href={portalHref(`/portal/security-review/${cycle.id}`, asOrganization)}
                onClick={closeHistory}
                variant={current ? 'light' : 'subtle'}
                color={current ? 'pine' : 'gray'}
                fullWidth
                h="auto"
                py="sm"
                justify="space-between"
                rightSection={
                  <StatusBadge
                    size="sm"
                    tone={ASSESSMENT_STATUS_TONE[cycle.status]}
                    label={ASSESSMENT_STATUS_LABEL[cycle.status]}
                  />
                }
              >
                <Stack gap={2} align="flex-start">
                  <Text size="sm" fw={700}>
                    Ciclo {history.length - index}
                    {current ? ' · Visualizando' : ''}
                  </Text>
                  <Text size="xs" c="dimmed" fw={400}>
                    Iniciada {formatDateTime(cycle.opened_at)}
                  </Text>
                </Stack>
              </Button>
            )
          })}
        </Stack>
      </Drawer>
      {data.assessment.status !== 'completed' && (data.previous_answers?.length ?? 0) > 0 && (
        <Text size="sm" c="pine.8" fw={600}>
          Se cargaron las respuestas anteriores · revísalas antes de completar este ciclo
        </Text>
      )}
      <AssessmentForm
        assessment={data.assessment}
        savedAnswers={data.answers}
        previousAnswers={data.previous_answers ?? []}
        effectiveEvidence={data.effective_evidence ?? {}}
        readOnly={readOnly}
        saving={actions.saveDraft.isPending}
        completing={actions.complete.isPending}
        onSave={command => actions.saveDraft.mutate(command)}
        // Completar cierra el trabajo: se vuelve a la lista (el toast confirma).
        onComplete={command =>
          actions.complete.mutate(command, { onSuccess: () => router.push(listHref) })
        }
        backHref={listHref}
        backLabel="Volver a Revisión de seguridad"
      />
    </Stack>
  )
}
