'use client'

import Link from 'next/link'
import {
  Badge,
  Button,
  Card,
  Group,
  Progress,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
} from '@mantine/core'
import { ArrowRight, ClipboardCheck } from 'lucide-react'
import { useAssessments } from '../hooks/use-assessments'

export function AssetSecurityReviewCard({
  assetId,
  asOrganization,
}: {
  assetId: string
  asOrganization?: string
}) {
  const query = useAssessments({ scope: 'asset', assetId, asOrganization })
  if (query.isPending) return <Skeleton height={112} radius="lg" />
  const assessment = query.data?.docs.find(item => item.status !== 'superseded')
  if (!assessment)
    return (
      <Card withBorder radius="lg" p="lg">
        <Group gap="md">
          <ThemeIcon color="gray" variant="light">
            <ClipboardCheck size={18} />
          </ThemeIcon>
          <div>
            <Text fw={650}>Security review</Text>
            <Text size="sm" c="dimmed">
              No everyday questions apply until this device type is confirmed.
            </Text>
          </div>
        </Group>
      </Card>
    )
  const summary = assessment.completion_summary
  const total =
    (summary?.compliant ?? 0) + (summary?.non_compliant ?? 0) + (summary?.not_evaluable ?? 0)
  const answered = assessment.status === 'completed' ? total : 0
  const suffix = asOrganization ? '?asOrganization=' + asOrganization : ''
  return (
    <Card
      withBorder
      radius="lg"
      p="lg"
      style={{ borderTop: '3px solid var(--mantine-color-pine-6)' }}
    >
      <Group justify="space-between" wrap="wrap">
        <Stack gap={6} style={{ flex: 1 }}>
          <Group gap="xs">
            <ThemeIcon color="pine" variant="light">
              <ClipboardCheck size={18} />
            </ThemeIcon>
            <Text fw={700}>Security review</Text>
            <Badge variant="filled" color={assessment.status === 'completed' ? 'green' : 'orange'}>
              {assessment.status.replaceAll('_', ' ')}
            </Badge>
          </Group>
          <Text size="sm" c="dimmed">
            Simple questions about how this computer is used and protected.
          </Text>
          <Progress value={total ? (answered / total) * 100 : 0} color="pine" radius="xl" />
        </Stack>
        <Button
          component={Link}
          href={'/portal/security-review/' + assessment.id + suffix}
          variant="light"
          rightSection={<ArrowRight size={16} />}
        >
          Review controls
        </Button>
      </Group>
    </Card>
  )
}
