'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  Alert,
  Anchor,
  Badge,
  Card,
  Group,
  Pagination,
  Progress,
  RingProgress,
  Skeleton,
  Stack,
  Text,
} from '@mantine/core'
import { PageHeader } from '@/components/ui/PageHeader'
import { DataTable } from '@/components/ui/DataTable'
import { useUiStore } from '@/lib/ui-store'
import { formatDateTime } from '@/lib/format-date'
import { RISK_BAND_LABEL, RISK_CONFIDENCE_LABEL } from '@/lib/enum-labels'
import { useLatestRisk } from '@/modules/risk/hooks/use-latest-risk'
import { riskContributionsColumns } from '@/modules/risk/risk.columns'
import { RiskAlerts } from '@/modules/risk/components/RiskAlerts'
import { TopRiskAssets } from '@/modules/risk/components/TopRiskAssets'
import { RISK_BAND_COLOR, RISK_SCORE_MEANING, RISK_SCORE_SCALE } from '@/modules/risk/risk-labels'

export default function RiskScorePage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const officeId = useUiStore(state => state.selectedOfficeId)
  const [page, setPage] = useState(1)
  // A different office or organization has its own evaluation: start again from the first page.
  useEffect(() => setPage(1), [officeId, asOrganization])
  const query = useLatestRisk({ officeId, asOrganization, page })
  const data = query.data?.evaluation
  const pagination = query.data?.pagination
  const inventoryHref = `/portal/inventory${asOrganization ? `?asOrganization=${asOrganization}` : ''}`

  return (
    <Stack gap="xl">
      <PageHeader
        title="Puntaje de riesgo"
        description="Una vista simple de los problemas de seguridad detectados y de la información que todavía falta revisar."
      />
      {query.isError && <Alert color="red">No se pudo cargar la última evaluación.</Alert>}
      {query.isPending ? (
        <Skeleton height={260} />
      ) : !data ? (
        <Alert color="blue">
          Todavía no existe una evaluación. El cálculo se ejecutará después del próxima revisión o
          ingreso de evidencia.
        </Alert>
      ) : (
        <>
          {data.score === null && data.coverage < 20 && (
            <Alert color="orange" title="Datos insuficientes">
              Complete las revisiones pendientes, identifique dispositivos y mantenga activo el
              agente para poder mostrar el puntaje.
            </Alert>
          )}
          {data.coverage >= 20 && data.coverage < 40 && (
            <Alert color="yellow" title="Resultado preliminar">
              La cobertura es baja: el puntaje se muestra como orientación, sin clasificación.
            </Alert>
          )}
          <Card withBorder radius="lg" p="xl">
            <Group justify="space-between" align="center" wrap="wrap">
              <Group>
                <RingProgress
                  size={144}
                  thickness={14}
                  // Without a band (preliminary result) the ring stays neutral instead of alarming.
                  sections={[
                    {
                      value: data.score ?? 0,
                      color: data.final_band ? RISK_BAND_COLOR[data.final_band] : 'gray',
                    },
                  ]}
                  label={
                    <Text ta="center" fw={800} fz={30}>
                      {data.score === null ? '—' : `${Math.round(data.score)} %`}
                    </Text>
                  }
                />
                <Stack gap={4}>
                  <Text fw={750}>Riesgo actual</Text>
                  {data.final_band && (
                    <Badge color={RISK_BAND_COLOR[data.final_band]}>
                      {RISK_BAND_LABEL[data.final_band]}
                    </Badge>
                  )}
                  {data.final_band && data.base_band !== data.final_band && (
                    <Text size="xs" c="dimmed">
                      El nivel subió porque varios problemas importantes se concentran en pocos
                      controles.
                    </Text>
                  )}
                  {data.score !== null && !data.final_band && (
                    <Badge color="gray" variant="light">
                      Preliminar
                    </Badge>
                  )}
                  <Text size="sm">
                    {data.score === null
                      ? 'Todavía no hay información suficiente para calcularlo.'
                      : `El ${Math.round(data.score)} % ${RISK_SCORE_MEANING}.`}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {RISK_SCORE_SCALE}. Cuanto más alto, mayor es la prioridad de mejora.
                  </Text>
                </Stack>
              </Group>
              <Stack miw={280}>
                <Group justify="space-between">
                  <Text fw={700}>Cobertura</Text>
                  <Text>{Math.round(data.coverage)}%</Text>
                </Group>
                <Progress value={data.coverage} color="pine" />
                <Group justify="space-between">
                  <Text fw={700}>Dispositivos sin identificar</Text>
                  <Text>{data.counts.unconfirmed_assets}</Text>
                </Group>
                {data.counts.unconfirmed_assets > 0 && (
                  <Anchor component={Link} href={inventoryHref} size="sm">
                    Identificarlos en el inventario
                  </Anchor>
                )}
                <Text size="sm">
                  Confiabilidad del resultado: {RISK_CONFIDENCE_LABEL[data.effective_confidence]}
                </Text>
                <Text size="xs" c="dimmed">
                  {data.counts.not_evaluable} comprobaciones sin información suficiente
                  {data.counts.excluded_assets > 0 &&
                    ` · ${data.counts.excluded_assets} dispositivos fuera de la revisión`}
                </Text>
              </Stack>
            </Group>
          </Card>
          <RiskAlerts alerts={data.alerts} inventoryHref={inventoryHref} />
          <TopRiskAssets assets={data.top_assets} />
          <Card withBorder radius="lg" p="lg">
            <Text fw={750} mb="md">
              Qué necesita atención
            </Text>
            <Text size="sm" c="dimmed" mb="md">
              Cada fila muestra qué se revisó, dónde se encontró y qué significa el resultado.
              Empieza por los elementos marcados como &quot;Requiere atención&quot;.
            </Text>
            <DataTable
              columns={riskContributionsColumns}
              data={query.data?.contributions ?? []}
              isLoading={query.isFetching}
              emptyLabel="Sin comprobaciones aplicables"
              minWidth={720}
            />
            {pagination && pagination.totalPages > 1 && (
              <Group justify="space-between" mt="md">
                <Text size="sm" c="dimmed">
                  {pagination.totalDocs} comprobaciones
                </Text>
                <Pagination total={pagination.totalPages} value={page} onChange={setPage} />
              </Group>
            )}
          </Card>
          <Text size="sm" c="dimmed">
            Último cálculo: {formatDateTime(data.evaluated_at)}
          </Text>
        </>
      )}
    </Stack>
  )
}
