import Link from 'next/link'
import { Anchor, Box, Card, Center, Group, Progress, Stack, Text } from '@mantine/core'
import { usePortalHref } from '@/lib/use-portal-href'
import { riskAssetPath } from '@/modules/assets/asset-path'
import { RiskBandBadge } from './RiskBandBadge'
import type { RiskEvaluationDTO } from '../service'

/** Assets with the highest deficiency index, with their own index and band. */
export function TopRiskAssets({ assets }: { assets: RiskEvaluationDTO['top_assets'] }) {
  const href = usePortalHref()
  if (!assets.length) return null
  return (
    <Card withBorder radius="lg" p="lg">
      <Text fw={750}>Equipos con más deficiencias</Text>
      <Text size="sm" c="dimmed" mb="md">
        El índice de cada equipo va de 0 (sin deficiencias) a 100 (ningún control cumple).
      </Text>
      <Stack gap="sm">
        {assets.map(asset => {
          const path = riskAssetPath(asset.asset_key)
          return (
            <Group key={asset.asset_key} justify="space-between" wrap="nowrap" gap="md">
              {path ? (
                <Anchor
                  component={Link}
                  href={href(path)}
                  size="sm"
                  c="inherit"
                  underline="hover"
                  style={{ flex: 1, minWidth: 0 }}
                  truncate
                >
                  {asset.asset_label}
                </Anchor>
              ) : (
                <Text size="sm" style={{ flex: 1 }} truncate>
                  {asset.asset_label}
                </Text>
              )}
              <Progress
                value={asset.index}
                w={160}
                color="red"
                aria-label="Índice de deficiencias"
                style={{ flexShrink: 0 }}
              />
              <Text size="sm" w={48} ta="right" style={{ flexShrink: 0 }}>
                {Math.round(asset.index)}
              </Text>
              {/* Columna de ancho fijo: los badges miden distinto (ALTA / MUY ALTA) y sin esto
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
          )
        })}
      </Stack>
    </Card>
  )
}
