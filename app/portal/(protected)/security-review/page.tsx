'use client'

import { Center, Group, Loader, Select, Stack, Text } from '@mantine/core'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { useAssessments } from '@/modules/assessments/hooks/use-assessments'
import {
  SecurityReviewList,
  SecurityReviewSummary,
} from '@/modules/assessments/components/SecurityReviewOverview'
import { useUiStore } from '@/lib/ui-store'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'
import { relationId } from '@/lib/relationId'
import { useRiskSummary } from '@/modules/assessments/hooks/use-risk-summary'

export default function SecurityReviewPage() {
  const params = useSearchParams()
  const asOrganization = params.get('asOrganization') ?? undefined
  const selectedOfficeId = useUiStore(state => state.selectedOfficeId)
  const [status, setStatus] = useState('current')
  const [assignment, setAssignment] = useState('all')
  const tenant = useTenantContext(asOrganization)
  const query = useAssessments({
    officeId: selectedOfficeId,
    asOrganization,
  })
  const risk = useRiskSummary({ officeId: selectedOfficeId, asOrganization })
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
        title="Security Review"
        description="Short, practical checks about how work gets done. Missing information lowers coverage; only confirmed issues affect risk."
      />
      {!query.isPending && !query.isError && (
        <SecurityReviewSummary assessments={query.data?.docs ?? []} riskSummary={risk.data} />
      )}
      <Stack gap="sm">
        <Group align="flex-end">
          <Select
            aria-label="Filter by review status"
            value={status}
            onChange={value => setStatus(value ?? 'current')}
            data={[
              { value: 'current', label: 'Current reviews' },
              { value: 'pending', label: 'Not started' },
              { value: 'in_progress', label: 'In progress' },
              { value: 'completed', label: 'Completed' },
              { value: 'expired', label: 'Review due' },
              { value: 'all', label: 'Full history' },
            ]}
            w={{ base: '100%', sm: 240 }}
          />
          <Select
            label="Assignment"
            value={assignment}
            onChange={value => setAssignment(value ?? 'all')}
            data={[
              { value: 'all', label: 'Everyone' },
              { value: 'mine', label: 'Assigned to me' },
            ]}
            w={{ base: '100%', sm: 220 }}
          />
        </Group>
      </Stack>
      {query.isPending ? (
        <Center py="xl">
          <Loader color="pine" />
        </Center>
      ) : query.isError ? (
        <Text c="red">Could not load security reviews.</Text>
      ) : (
        <SecurityReviewList assessments={rows} suffix={suffix} />
      )}
    </Stack>
  )
}
