'use client'

import { Center, Loader, Select, Stack, Text } from '@mantine/core'
import { FilterBar } from '@/components/ui/FilterBar'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { useAssessments } from '@/modules/assessments/hooks/use-assessments'
import {
  SecurityReviewList,
  SecurityReviewSummary,
} from '@/modules/assessments/components/SecurityReviewOverview'
import { useConcreteOfficeId } from '@/modules/offices/hooks/use-concrete-office-id'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'
import { relationId } from '@/lib/relationId'
import { useRiskSummary } from '@/modules/assessments/hooks/use-risk-summary'

export default function SecurityReviewPage() {
  const params = useSearchParams()
  const asOrganization = params.get('asOrganization') ?? undefined
  const { officeId: selectedOfficeId, ready } = useConcreteOfficeId(asOrganization)
  const [status, setStatus] = useState('current')
  const [assignment, setAssignment] = useState('all')
  const tenant = useTenantContext(asOrganization)
  const query = useAssessments({
    officeId: selectedOfficeId,
    asOrganization,
  })
  const risk = useRiskSummary({ officeId: selectedOfficeId, asOrganization, enabled: ready })
  const rows = (query.data?.docs ?? []).filter(
    item =>
      (status === 'all'
        ? true
        : status === 'current'
          ? item.status !== 'superseded'
          : item.status === status) &&
      (assignment === 'mine'
        ? Boolean(item.assigned_to && relationId(item.assigned_to) === tenant.data?.userId)
        : true)
  )
  const suffix = asOrganization ? '?asOrganization=' + asOrganization : ''

  return (
    <Stack gap="xl">
      <PageHeader
        title="Revisión de seguridad"
        description="Controles breves y prácticos sobre cómo se realiza el trabajo. La información faltante reduce la cobertura, pero no aumenta el riesgo; lo aumentan las protecciones ausentes o incompletas."
      />
      {!query.isPending && !query.isError && (
        <SecurityReviewSummary
          assessments={query.data?.docs ?? []}
          riskSummary={risk.data}
          riskHref={`/portal/risk-score${suffix}`}
        />
      )}
      <Stack gap="sm">
        <FilterBar>
          <Select
            placeholder="Estado de revisión"
            aria-label="Filtrar por estado de revisión"
            value={status}
            onChange={value => setStatus(value ?? 'current')}
            data={[
              { value: 'current', label: 'Revisiones actuales' },
              { value: 'pending', label: 'Sin iniciar' },
              { value: 'in_progress', label: 'En curso' },
              { value: 'completed', label: 'Completada' },
              { value: 'expired', label: 'Revisión vencida' },
              { value: 'all', label: 'Historial completo' },
            ]}
            w="100%"
          />
          <Select
            placeholder="Asignación"
            aria-label="Filtrar por asignación"
            value={assignment}
            onChange={value => setAssignment(value ?? 'all')}
            data={[
              { value: 'all', label: 'Todas las personas' },
              { value: 'mine', label: 'Asignadas a mí' },
            ]}
            w="100%"
          />
        </FilterBar>
      </Stack>
      {query.isPending ? (
        <Center py="xl">
          <Loader color="pine" />
        </Center>
      ) : query.isError ? (
        <Text c="red">No se pudieron cargar las revisiones de seguridad.</Text>
      ) : (
        <SecurityReviewList assessments={rows} suffix={suffix} asOrganization={asOrganization} />
      )}
    </Stack>
  )
}
