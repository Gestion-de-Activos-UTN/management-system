'use client'

import { useEffect, useRef, useState } from 'react'
import type { SortingState } from '@tanstack/react-table'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  Alert,
  Anchor,
  Card,
  Group,
  Pagination,
  Progress,
  RingProgress,
  Select,
  Skeleton,
  Stack,
  Text,
} from '@mantine/core'
import { PageHeader } from '@/components/ui/PageHeader'
import { DataTable } from '@/components/ui/DataTable'
import { useConcreteOfficeId } from '@/modules/offices/hooks/use-concrete-office-id'
import { formatDateTime } from '@/lib/format-date'
import { RISK_CONFIDENCE_LABEL } from '@/lib/enum-labels'
import { useLatestRisk } from '@/modules/risk/hooks/use-latest-risk'
import { riskContributionsColumns } from '@/modules/risk/risk.columns'
import { RiskAlerts } from '@/modules/risk/components/RiskAlerts'
import { TopRiskAssets } from '@/modules/risk/components/TopRiskAssets'
import { RiskBandBadge } from '@/modules/risk/components/RiskBandBadge'
import { RISK_BAND_COLOR, RISK_SCORE_MEANING, RISK_SCORE_SCALE } from '@/modules/risk/risk-labels'
import {
  bandVisible,
  RISK_DEFAULT_PAGE_SIZE,
  RISK_PAGE_SIZES,
  type RiskSortKey,
  scoreVisible,
} from '@/domain/risk/constants'
import { portalHref } from '@/lib/portal-href'
import { CreateRelatedTaskButton } from '@/modules/tasks/components/CreateRelatedTaskButton'
import { StatusBadge } from '@/components/ui/StatusBadge'

export default function RiskScorePage() {
  const searchParams = useSearchParams()
  const asOrganization = searchParams.get('asOrganization') ?? undefined
  const evaluationId = searchParams.get('evaluation') ?? undefined
  const { officeId, ready } = useConcreteOfficeId(asOrganization)
  const [page, setPage] = useState(1)
  // Al cambiar de página la lista vuelve a su encabezado, no se queda en el pie de la anterior.
  const tableRef = useRef<HTMLDivElement>(null)
  const changePage = (next: number) => {
    setPage(next)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    tableRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
  }
  const [pageSize, setPageSize] = useState<number>(RISK_DEFAULT_PAGE_SIZE)
  // El servidor ordena toda la evaluación y después pagina; sin orden elegido usa el control.
  const [sorting, setSorting] = useState<SortingState>([])
  const sort = sorting[0]
  // Otra oficina, organización, tamaño u orden tiene sus propias páginas: vuelve a la primera.
  useEffect(
    () => setPage(1),
    [officeId, asOrganization, evaluationId, pageSize, sort?.id, sort?.desc]
  )
  const query = useLatestRisk({
    officeId,
    asOrganization,
    evaluationId,
    page,
    limit: pageSize,
    sort: sort?.id as RiskSortKey | undefined,
    direction: sort ? (sort.desc ? 'desc' : 'asc') : undefined,
    enabled: ready,
  })
  const data = query.data?.evaluation
  const pagination = query.data?.pagination
  const inventoryHref = portalHref('/portal/inventory', asOrganization)

  return (
    <Stack gap="xl">
      {evaluationId && (
        <Alert color="blue" title="Evaluación histórica">
          Esta es la evidencia que originó la tarea. El puntaje vigente puede ser diferente.
        </Alert>
      )}
      <PageHeader
        title="Puntaje de riesgo"
        description="Una vista simple de los problemas de seguridad detectados y de la información que todavía falta revisar."
        rightSection={
          data ? (
            <CreateRelatedTaskButton
              reference={{ relationTo: 'risk-evaluations', value: String(data.id) }}
              asOrganization={asOrganization}
            />
          ) : undefined
        }
      />
      {query.isError && <Alert color="red">No se pudo cargar la última evaluación.</Alert>}
      {(query.data?.recalculation === 'pending' ||
        query.data?.recalculation === 'processing' ||
        query.data?.recalculation === 'outdated') && (
        <Alert color="blue" title="Actualización pendiente">
          Los cambios están guardados. El puntaje mostrado corresponde al cálculo anterior y se
          actualizará cuando termine el recálculo.
        </Alert>
      )}
      {query.data?.recalculation === 'failed' && (
        <Alert color="orange" title="Actualización pendiente de recuperación">
          El recálculo no pudo completarse. Los cambios están guardados, pero el puntaje puede estar
          desactualizado.
        </Alert>
      )}
      {query.isPending ? (
        <Skeleton height={260} />
      ) : !data ? (
        <Alert color="blue">
          Todavía no existe una evaluación. El cálculo se ejecutará después del próxima revisión o
          ingreso de evidencia.
        </Alert>
      ) : (
        <>
          {!scoreVisible(data.confidence) && (
            <Alert color="orange" title="Datos insuficientes">
              Complete las revisiones pendientes, identifique dispositivos y mantenga activo el
              agente para poder mostrar el puntaje.
            </Alert>
          )}
          {scoreVisible(data.confidence) && !bandVisible(data.confidence) && (
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
                  {data.final_band && <RiskBandBadge band={data.final_band} />}
                  {data.final_band && data.base_band !== data.final_band && (
                    <Text size="xs" c="dimmed">
                      El nivel subió porque varios problemas importantes se concentran en pocos
                      controles.
                    </Text>
                  )}
                  {data.score !== null && !data.final_band && (
                    <StatusBadge tone="neutral" label="Preliminar" />
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
          <Card
            ref={tableRef}
            withBorder
            radius="lg"
            p="lg"
            // Deja a la vista el encabezado fijo de la app al desplazarse hasta acá.
            style={{ scrollMarginTop: 'calc(var(--app-shell-header-height, 0px) + 16px)' }}
          >
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
              // Sólo la carga de otra página/tamaño (datos de relleno), no el refresco de fondo de
              // cada 30 s: si no, la tabla se atenuaba sola periódicamente.
              isLoading={query.isPending || query.isPlaceholderData}
              manualSorting
              sorting={sorting}
              onSortingChange={setSorting}
              emptyLabel="Sin comprobaciones aplicables"
              minWidth={720}
            />
            {pagination && pagination.totalDocs > RISK_PAGE_SIZES[0] && (
              <Group justify="space-between" mt="md">
                <Group gap="sm">
                  <Text size="sm" c="dimmed">
                    {pagination.totalDocs} comprobaciones
                  </Text>
                  <Select
                    aria-label="Filas por página"
                    data={RISK_PAGE_SIZES.map(size => ({
                      value: String(size),
                      label: `${size} por página`,
                    }))}
                    value={String(pageSize)}
                    onChange={value => value && setPageSize(Number(value))}
                    w={140}
                    size="xs"
                  />
                </Group>
                {pagination.totalPages > 1 && (
                  <Pagination total={pagination.totalPages} value={page} onChange={changePage} />
                )}
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
