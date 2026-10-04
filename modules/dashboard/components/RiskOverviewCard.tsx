import Link from 'next/link'
import {
  Badge,
  Box,
  Button,
  Card,
  Group,
  Paper,
  Progress,
  Skeleton,
  Stack,
  Text,
} from '@mantine/core'
import { ArrowRight } from 'lucide-react'
import { RiskBandBadge } from '@/modules/risk/components/RiskBandBadge'
import { RISK_ROBOT_MESSAGE, RiskRobot, riskRobotMood } from '@/modules/risk/components/RiskRobot'
import type { SecurityReviewSummary } from '@/modules/assessments/service'

/**
 * Bloque principal del panel general, a todo el ancho: el riesgo es el dato base y todo lo demás
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
  if (isPending) return <Skeleton height={220} radius="lg" />
  const score = summary?.risk_score ?? null
  const band = summary?.risk_band ?? null
  const coverage = Math.round(summary?.evaluated_percentage ?? 0)
  const applicable = summary?.applicable_checks ?? 0
  const evaluated = Math.max(0, applicable - (summary?.not_evaluable ?? 0))
  return (
    <Card withBorder radius="lg" p="xl">
      <Group justify="space-between" align="center" gap="xl" wrap="wrap">
        <Group gap="xl" wrap="nowrap" align="center" style={{ flex: '1 1 420px', minWidth: 0 }}>
          <RiskRobot score={score} band={band} size={150} />
          <Stack gap="sm" style={{ flex: 1, minWidth: 0 }}>
            <Text fw={700} c="dimmed" size="sm" tt="uppercase">
              Riesgo actual
            </Text>
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
            <Text size="xs" c="dimmed">
              {score === null
                ? 'Completa revisiones e identifica equipos para poder calcularlo.'
                : 'Porcentaje del riesgo de la organización que sigue sin tratar.'}
            </Text>
          </Stack>
        </Group>
        <Box style={{ flex: '0 1 320px' }} miw={260}>
          <Stack gap="sm">
            <Group justify="space-between">
              <Text size="sm" fw={600}>
                Cobertura de evidencia
              </Text>
              <Text size="sm" fw={700}>
                {coverage} %
              </Text>
            </Group>
            <Progress value={coverage} color="pine" radius="xl" size="lg" />
            <Text size="xs" c="dimmed">
              Información vigente para {evaluated} de {applicable} comprobaciones. La información
              faltante no aumenta el riesgo, pero lo vuelve menos preciso.
            </Text>
            <Button
              component={Link}
              href={href}
              variant="light"
              mt="xs"
              rightSection={<ArrowRight size={16} strokeWidth={1.5} />}
            >
              Ver puntaje de riesgo
            </Button>
          </Stack>
        </Box>
      </Group>
    </Card>
  )
}
