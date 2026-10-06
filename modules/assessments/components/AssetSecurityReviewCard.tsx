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

const STATUS_LABEL = {
  pending: 'Sin iniciar',
  in_progress: 'En curso',
  completed: 'Completada',
  expired: 'Vencida',
  superseded: 'Reemplazada',
} as const

export function AssetSecurityReviewCard({
  assetId,
  asOrganization,
  excluded = false,
}: {
  assetId: string
  asOrganization?: string
  excluded?: boolean
}) {
  const query = useAssessments({ scope: 'asset', assetId, asOrganization })
  if (excluded)
    return (
      <Card withBorder radius="lg" p="lg">
        <Group gap="md">
          <ThemeIcon color="gray" variant="light">
            <ClipboardCheck size={18} />
          </ThemeIcon>
          <div>
            <Text fw={650}>Excluido de las evaluaciones de seguridad</Text>
            <Text size="sm" c="dimmed">
              Este activo permanece visible y puede seguir escaneándose, pero no afecta el puntaje
              de riesgo.
            </Text>
          </div>
        </Group>
      </Card>
    )
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
            <Text fw={650}>Revisión de seguridad</Text>
            <Text size="sm" c="dimmed">
              No se aplican preguntas cotidianas hasta confirmar el tipo de dispositivo.
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
            <Text fw={700}>Revisión de seguridad</Text>
            <Badge variant="filled" color={assessment.status === 'completed' ? 'green' : 'orange'}>
              {STATUS_LABEL[assessment.status]}
            </Badge>
          </Group>
          <Text size="sm" c="dimmed">
            Preguntas sencillas sobre cómo se usa y protege esta computadora.
          </Text>
          <Progress value={total ? (answered / total) * 100 : 0} color="pine" radius="xl" />
        </Stack>
        <Button
          component={Link}
          href={'/portal/security-review/' + assessment.id + suffix}
          variant="light"
          rightSection={<ArrowRight size={16} />}
        >
          Revisar controles
        </Button>
      </Group>
    </Card>
  )
}
