import Link from 'next/link'
import { Alert, Button, Card, Group, Paper, Skeleton, Stack, Text } from '@mantine/core'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ArrowRight } from 'lucide-react'
import { RiskScopeExplanation } from '@/modules/risk/components/RiskScopeExplanation'
import { RiskBandBadge } from '@/modules/risk/components/RiskBandBadge'
import { RISK_ROBOT_MESSAGE, RiskRobot, riskRobotMood } from '@/modules/risk/components/RiskRobot'
import { RISK_SCORE_MEANING } from '@/modules/risk/risk-labels'
import type { SecurityReviewSummary } from '@/modules/assessments/service'

/**
 * Bloque principal del panel general: el riesgo es el dato base y todo lo demás
 * (equipos, revisiones, tareas) son formas de bajarlo. La mascota resume el nivel en un gesto;
 * el puntaje y el nivel siempre están también como texto.
 */
export function RiskOverviewCard({
  summary,
  isPending,
  isError = false,
  href,
}: {
  summary?: SecurityReviewSummary
  isPending: boolean
  isError?: boolean
  href: string
}) {
  if (isPending) return <Skeleton height={190} radius="lg" />
  // Without a summary a failure must not read as "no risk": the card says it could not load.
  if (isError && !summary)
    return <Alert color="red">No se pudo cargar el índice. Intenta de nuevo en unos minutos.</Alert>
  const index = summary?.index ?? null
  const band = summary?.band ?? null
  return (
    <Card withBorder radius="lg" p="xl">
      <Group gap="xl" wrap="nowrap" align="center">
        <RiskRobot index={index} band={band} size={128} />
        <Stack gap="sm" style={{ flex: 1, minWidth: 0 }}>
          <Text fw={700} c="dimmed" size="sm" tt="uppercase">
            {summary?.scope === 'organization'
              ? 'Deficiencias de la organización'
              : summary?.scope === 'assigned_offices'
                ? 'Deficiencias de tus oficinas'
                : 'Deficiencias actuales'}
          </Text>
          <RiskScopeExplanation scope={summary?.scope} />
          {summary?.recalculation &&
            summary.recalculation !== 'current' &&
            summary.recalculation !== 'outdated' && (
              <StatusBadge
                tone={summary.recalculation === 'failed' ? 'danger' : 'warning'}
                label={
                  summary.recalculation === 'failed'
                    ? 'No se pudo completar el cálculo'
                    : 'Actualizando el índice'
                }
              />
            )}
          <Group gap="sm" align="center">
            <Text fw={800} fz={44} lh={1}>
              {index === null ? '—' : Math.round(index)}
            </Text>
            {band ? (
              <RiskBandBadge band={band} size="lg" />
            ) : (
              <StatusBadge
                size="lg"
                tone="neutral"
                label={index === null ? 'Sin datos suficientes' : 'Preliminar'}
              />
            )}
          </Group>
          {/* Lo que "dice" el robot: globo de diálogo apuntando hacia él. */}
          <Paper withBorder radius="md" px="sm" py={8} className="robot-bubble" maw={460}>
            <Text size="sm">{RISK_ROBOT_MESSAGE[riskRobotMood(index, band)]}</Text>
          </Paper>
          <Group justify="space-between" gap="sm" wrap="wrap">
            <Text size="xs" c="dimmed">
              {index === null
                ? 'Completa revisiones e identifica equipos para poder calcularlo.'
                : RISK_SCORE_MEANING}
            </Text>
            <Button
              component={Link}
              href={href}
              variant="light"
              size="xs"
              rightSection={<ArrowRight size={14} strokeWidth={1.5} />}
            >
              Ver deficiencias
            </Button>
          </Group>
        </Stack>
      </Group>
    </Card>
  )
}
