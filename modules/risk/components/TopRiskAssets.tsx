import { Box, Card, Center, Group, Progress, Stack, Text } from '@mantine/core'
import { RiskBandBadge } from './RiskBandBadge'
import type { RiskEvaluationDTO } from '../service'

/** Assets with the highest residual risk, with their own score and band. */
export function TopRiskAssets({ assets }: { assets: RiskEvaluationDTO['top_assets'] }) {
  if (!assets.length) return null
  return (
    <Card withBorder radius="lg" p="lg">
      <Text fw={750}>Equipos con más riesgo sin tratar</Text>
      <Text size="sm" c="dimmed" mb="md">
        El porcentaje indica qué parte del riesgo de cada equipo sigue sin tratar.
      </Text>
      <Stack gap="sm">
        {assets.map(asset => (
          <Group key={asset.asset_id} justify="space-between" wrap="nowrap" gap="md">
            <Text size="sm" style={{ flex: 1 }} truncate>
              {asset.asset_label}
            </Text>
            <Progress
              value={asset.score ?? 0}
              w={160}
              color="red"
              aria-label="Riesgo sin tratar"
              style={{ flexShrink: 0 }}
            />
            <Text size="sm" w={48} ta="right" style={{ flexShrink: 0 }}>
              {asset.score === null ? '—' : `${Math.round(asset.score)}%`}
            </Text>
            {/* Columna de ancho fijo: los badges miden distinto (ALTO / CRÍTICO) y sin esto
                desplazan la barra de cada fila. */}
            <Box w={84} style={{ flexShrink: 0 }}>
              {asset.band ? (
                <Center>
                  <RiskBandBadge band={asset.band} />
                </Center>
              ) : (
                <Text size="xs" c="dimmed" ta="center">
                  Preliminar
                </Text>
              )}
            </Box>
          </Group>
        ))}
      </Stack>
    </Card>
  )
}
