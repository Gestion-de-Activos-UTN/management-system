'use client'

import { useSearchParams } from 'next/navigation'
import {
  Alert,
  Card,
  Divider,
  Group,
  Progress,
  RingProgress,
  Skeleton,
  Stack,
  Text,
} from '@mantine/core'
import { PageHeader } from '@/components/ui/PageHeader'
import { useUiStore } from '@/lib/ui-store'
import { formatDateTime } from '@/lib/format-date'
import { useRiskSummary } from '@/modules/assessments/hooks/use-risk-summary'

export default function RiskScorePage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const officeId = useUiStore(state => state.selectedOfficeId)
  const { data, isPending, isError } = useRiskSummary({ officeId, asOrganization })

  return (
    <Stack gap="xl">
      <PageHeader
        title="Risk Score"
        description="Confirmed issues determine risk. Missing or expired information is shown separately as coverage."
      />
      {isError && <Alert color="red">Could not calculate the current security summary.</Alert>}
      <Card withBorder radius="lg" p={{ base: 'lg', sm: 'xl' }}>
        <Group align="center" justify="space-between" wrap="wrap" gap="xl">
          <div>
            <Text size="xs" tt="uppercase" fw={800} c="dimmed" mb="lg">
              Current risk
            </Text>
            {isPending ? (
              <Skeleton height={144} circle />
            ) : (
              <Group align="center" gap="xl">
                <RingProgress
                  size={144}
                  thickness={14}
                  sections={[{ value: data?.risk_score ?? 0, color: 'red' }]}
                  label={
                    <Text ta="center" fw={800} fz={data?.risk_score === null ? 20 : 32}>
                      {data?.risk_score ?? '—'}
                    </Text>
                  }
                />
                <div>
                  <Text fw={700} fz="lg">
                    {data?.risk_score === null ? 'Not evaluable yet' : 'Weighted Risk Score'}
                  </Text>
                  <Text size="sm" c="dimmed" maw={300}>
                    Only current checks that require attention increase this number.
                  </Text>
                </div>
              </Group>
            )}
          </div>
          <Stack gap="xs" miw={260} style={{ flex: 1 }} maw={420}>
            <Group justify="space-between">
              <Text fw={700}>Evidence coverage</Text>
              <Text fw={800}>{data?.evaluated_percentage ?? 0}%</Text>
            </Group>
            <Progress value={data?.evaluated_percentage ?? 0} color="pine" size="lg" radius="xl" />
            <Text size="sm" c="dimmed">
              {(data?.applicable_checks ?? 0) - (data?.not_evaluable ?? 0)} of{' '}
              {data?.applicable_checks ?? 0} current checks are evaluable. Unknown, missing, expired
              or inconclusive checks lower coverage without adding risk.
            </Text>
          </Stack>
        </Group>
        <Divider my="xl" />
        <Group gap="xl" wrap="wrap">
          <Metric value={data?.requires_attention ?? 0} label="Require attention" />
          <Metric value={data?.not_evaluable ?? 0} label="Not evaluable" />
          <Metric value={data?.pending_asset_identifications ?? 0} label="Devices to identify" />
          <Metric value={data?.excluded_assets ?? 0} label="Assets out of scope" />
        </Group>
      </Card>
      <Text size="sm" c="dimmed">
        Policy: {data?.policy.key ?? '—'} v{data?.policy.version ?? '—'} · Last valid scan:{' '}
        {data?.last_valid_scan_at ? formatDateTime(data.last_valid_scan_at) : 'none available'}
      </Text>
    </Stack>
  )
}

function Metric(props: { value: number; label: string }) {
  return (
    <div>
      <Text fw={750} fz="xl">
        {props.value}
      </Text>
      <Text size="sm" c="dimmed">
        {props.label}
      </Text>
    </div>
  )
}
