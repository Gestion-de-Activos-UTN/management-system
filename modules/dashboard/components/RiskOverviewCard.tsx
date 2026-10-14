import Link from 'next/link'
import { Badge, Button, Card, Group, Paper, Skeleton, Stack, Text } from '@mantine/core'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ArrowRight } from 'lucide-react'
import { RiskBandBadge } from '@/modules/risk/components/RiskBandBadge'
import { RISK_ROBOT_MESSAGE, RiskRobot, riskRobotMood } from '@/modules/risk/components/RiskRobot'
import type { SecurityReviewSummary } from '@/modules/assessments/service'

/**
 * Bloque principal del panel general: el riesgo es el dato base y todo lo demás
 * (equipos, revisiones, tareas) son formas de bajarlo. La mascota resume el nivel en un gesto;
 * el puntaje y el nivel siempre están también como texto.
 */
export function RiskOverviewCard({
  summary,
  isPending,
  href,
}: {
  summary?: SecurityReviewSummary
  isPending: boolean
  href: string
}) {
  if (isPending) return <Skeleton height={190} radius="lg" />
  const score = summary?.risk_score ?? null
  const band = summary?.risk_band ?? null
  return (
    <Card withBorder radius="lg" p="xl">
      <Group gap="xl" wrap="nowrap" align="center">
        <RiskRobot score={score} band={band} size={128} />
        <Stack gap="sm" style={{ flex: 1, minWidth: 0 }}>
          <Text fw={700} c="dimmed" size="sm" tt="uppercase">
            Riesgo actual
          </Text>
          {summary?.recalculation && summary.recalculation !== 'current' && (
            <StatusBadge
              tone={summary.recalculation === 'failed' ? 'danger' : 'warning'}
              label={
                summary.recalculation === 'failed'
                  ? 'Actualización pendiente de recuperación'
                  : 'Actualizando riesgo'
              }
            />
          )}
          <Group gap="sm" align="center">
            <Text fw={800} fz={44} lh={1}>
              {score === null ? '—' : `${Math.round(score)} %`}
            </Text>
            {band ? (
              <RiskBandBadge band={band} size="lg" />
            ) : (
              <Badge size="lg" color="gray" variant="light">
                {score === null ? 'Sin datos suficientes' : 'Preliminar'}
              </Badge>
            )}
          </Group>
          {/* Lo que "dice" el robot: globo de diálogo apuntando hacia él. */}
          <Paper withBorder radius="md" px="sm" py={8} className="robot-bubble" maw={460}>
            <Text size="sm">{RISK_ROBOT_MESSAGE[riskRobotMood(score, band)]}</Text>
          </Paper>
          <Group justify="space-between" gap="sm" wrap="wrap">
            <Text size="xs" c="dimmed">
              {score === null
                ? 'Completa revisiones e identifica equipos para poder calcularlo.'
                : 'Porcentaje del riesgo de la organización que sigue sin tratar.'}
            </Text>
            <Button
              component={Link}
              href={href}
              variant="light"
              size="xs"
              rightSection={<ArrowRight size={14} strokeWidth={1.5} />}
            >
              Ver puntaje de riesgo
            </Button>
          </Group>
        </Stack>
      </Group>
    </Card>
  )
}
