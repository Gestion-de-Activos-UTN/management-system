import { Group, Paper, Progress, Skeleton, Stack, Text } from '@mantine/core'
import type { SecurityReviewSummary } from '@/modules/assessments/service'

/** Qué tan completa es la información sobre la que se calcula el riesgo, en una franja. */
export function EvidenceCoverageStrip({
  summary,
  isPending,
  isError = false,
}: {
  summary?: SecurityReviewSummary
  isPending: boolean
  isError?: boolean
}) {
  if (isPending) return <Skeleton height={76} radius="lg" />
  // The risk card already reports the failure; a 0 % strip would read as missing evidence.
  if (isError && !summary) return null
  const coverage = Math.round(summary?.evaluated_percentage ?? 0)
  const applicable = summary?.applicable_checks ?? 0
  const evaluated = Math.max(0, applicable - (summary?.not_evaluable ?? 0))
  return (
    <Paper withBorder radius="lg" px="md" py="sm">
      <Stack gap={6}>
        <Group justify="space-between" gap="sm">
          <Text size="sm" fw={600}>
            Cobertura de evidencia
          </Text>
          <Text size="sm" fw={700}>
            {coverage} %
          </Text>
        </Group>
        <Progress value={coverage} color="pine" radius="xl" size="md" />
        <Text size="xs" c="dimmed">
          Información vigente para {evaluated} de {applicable} comprobaciones. La información
          faltante no aumenta el riesgo, pero lo vuelve menos preciso.
        </Text>
      </Stack>
    </Paper>
  )
}
