import { Card, Group, Progress, Stack, Text } from '@mantine/core'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { RISK_BAND_LABEL } from '@/lib/enum-labels'
import { RISK_BAND_TONE } from '../risk-labels'
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
            <Progress value={asset.score ?? 0} w={160} color="red" aria-label="Riesgo sin tratar" />
            <Text size="sm" w={48} ta="right">
              {asset.score === null ? '—' : `${Math.round(asset.score)}%`}
            </Text>
            {asset.band ? (
              <StatusBadge tone={RISK_BAND_TONE[asset.band]} label={RISK_BAND_LABEL[asset.band]} />
            ) : (
              <Text size="xs" c="dimmed" w={72} ta="center">
                Preliminar
              </Text>
            )}
          </Group>
        ))}
      </Stack>
    </Card>
  )
}
