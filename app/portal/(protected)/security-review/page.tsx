'use client'

import { Button, Center, Loader, SegmentedControl, Stack, Text, Tooltip } from '@mantine/core'
import { MultiFilterSelect } from '@/components/ui/MultiFilterSelect'
import Link from 'next/link'
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
import { ListChecks } from 'lucide-react'
import {
  ASSESSMENT_STATUS_LABEL,
  canUseBulkAssessments,
} from '@/modules/assessments/assessment-labels'
import { portalHref } from '@/lib/portal-href'

const STATUS_OPTIONS = Object.entries(ASSESSMENT_STATUS_LABEL).map(([value, label]) => ({
  value,
  label,
}))
const CURRENT_STATUSES = STATUS_OPTIONS.map(option => option.value).filter(
  value => value !== 'superseded'
)

export default function SecurityReviewPage() {
  const params = useSearchParams()
  const asOrganization = params.get('asOrganization') ?? undefined
  const { officeId: selectedOfficeId, ready } = useConcreteOfficeId(asOrganization)
  // Abre con las revisiones vigentes: todo menos las reemplazadas por un ciclo nuevo.
  const [status, setStatus] = useState<string[]>(CURRENT_STATUSES)
  const [assignment, setAssignment] = useState('all')
  // Las oficinas inactivas no cuentan: sus revisiones quedan ocultas salvo que se pidan.
  const [officeState, setOfficeState] = useState('active')
  const tenant = useTenantContext(asOrganization)
  // La lista respeta el alcance del rol: toda la organización o todas sus oficinas asignadas.
  // selectedOfficeId sólo acota el resumen, porque el riesgo se calcula por oficina.
  const query = useAssessments({
    asOrganization,
  })
  const risk = useRiskSummary({ officeId: selectedOfficeId, asOrganization, enabled: ready })
  const docs = query.data?.docs ?? []
  const fromInactiveOffice = (item: (typeof docs)[number]) =>
    typeof item.office === 'object' && item.office?.is_active === false
  const hasInactiveOffices = docs.some(fromInactiveOffice)
  // Con una oficina elegida, el resumen cuenta las de esa oficina y las de la organización (que
  // también pesan en su evaluación), igual que la tarjeta de riesgo de al lado.
  const summaryDocs = docs.filter(
    item =>
      !fromInactiveOffice(item) &&
      (!selectedOfficeId ||
        item.scope === 'organization' ||
        (item.office && relationId(item.office) === selectedOfficeId))
  )
  const scoped = officeState === 'all' ? docs : docs.filter(item => !fromInactiveOffice(item))
  const rows = scoped.filter(
    item =>
      (!status.length || status.includes(item.status)) &&
      (assignment === 'mine'
        ? Boolean(item.assigned_to && relationId(item.assigned_to) === tenant.data?.userId)
        : true)
  )
  const canUseBulk = canUseBulkAssessments(tenant.data)

  return (
    <Stack gap="xl">
      <PageHeader
        title="Revisión de seguridad"
        description="Controles breves y prácticos sobre cómo se realiza el trabajo. La información faltante reduce la cobertura, pero no aumenta el riesgo; lo aumentan las protecciones ausentes o incompletas."
        rightSection={
          canUseBulk ? (
            <Button
              variant="light"
              leftSection={<ListChecks size={16} strokeWidth={1.5} />}
              component={Link}
              href={portalHref('/portal/security-review/bulk', asOrganization)}
            >
              Responder varias
            </Button>
          ) : null
        }
      />
      {!query.isPending && !query.isError && (
        <SecurityReviewSummary
          assessments={summaryDocs}
          riskSummary={risk.data}
          riskHref={portalHref('/portal/risk-score', asOrganization)}
        />
      )}
      <Stack gap="sm">
        <FilterBar>
          <MultiFilterSelect
            ariaLabel="Estado de revisión"
            allLabel="Todos los estados"
            data={STATUS_OPTIONS}
            value={status}
            onChange={setStatus}
          />
          <Tooltip label="Asignación">
            <SegmentedControl
              aria-label="Asignación"
              fullWidth
              data={[
                { value: 'all', label: 'Todas' },
                { value: 'mine', label: 'Mías' },
              ]}
              value={assignment}
              onChange={setAssignment}
            />
          </Tooltip>
          {hasInactiveOffices && (
            <Tooltip label="Oficinas">
              <SegmentedControl
                aria-label="Oficinas"
                fullWidth
                data={[
                  { value: 'active', label: 'Activas' },
                  { value: 'all', label: 'Todas' },
                ]}
                value={officeState}
                onChange={setOfficeState}
              />
            </Tooltip>
          )}
        </FilterBar>
      </Stack>
      {query.isPending ? (
        <Center py="xl">
          <Loader color="pine" />
        </Center>
      ) : query.isError ? (
        <Text c="red">No se pudieron cargar las revisiones de seguridad.</Text>
      ) : (
        <SecurityReviewList assessments={rows} asOrganization={asOrganization} />
      )}
    </Stack>
  )
}
