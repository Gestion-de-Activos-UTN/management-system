'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  Alert,
  Anchor,
  Card,
  Flex,
  Group,
  Pagination,
  Progress,
  RingProgress,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Tabs,
  Text,
} from '@mantine/core'
import { ClipboardList, ShieldAlert } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { OfficeRiskSelectionNotice } from '@/modules/offices/components/OfficeRiskSelectionNotice'
import { useConcreteOfficeId } from '@/modules/offices/hooks/use-concrete-office-id'
import { formatDateTime } from '@/lib/format-date'
import { RISK_VISIBILITY_LABEL } from '@/lib/enum-labels'
import { useLatestRisk } from '@/modules/risk/hooks/use-latest-risk'
import { RiskItemList } from '@/modules/risk/components/RiskItemList'
import { ControlCoverage } from '@/modules/risk/components/ControlCoverage'
import type { RiskList } from '@/modules/risk/service'
import { RiskScopeExplanation } from '@/modules/risk/components/RiskScopeExplanation'
import { RiskAlerts } from '@/modules/risk/components/RiskAlerts'
import { TopRiskAssets } from '@/modules/risk/components/TopRiskAssets'
import { RiskBandBadge } from '@/modules/risk/components/RiskBandBadge'
import { RISK_BAND_COLOR, RISK_SCORE_MEANING, RISK_SCORE_SCALE } from '@/modules/risk/risk-labels'
import { RISK_DEFAULT_PAGE_SIZE, RISK_PAGE_SIZES } from '@/domain/risk/constants'
import { indexVisible } from '@/domain/risk/deficiency-index'
import { portalHref } from '@/lib/portal-href'
import { CreateRelatedTaskButton } from '@/modules/tasks/components/CreateRelatedTaskButton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { getRiskCalculationMessage } from '@/modules/risk/risk-calculation-message'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'

export default function RiskScorePage() {
  const searchParams = useSearchParams()
  const asOrganization = searchParams.get('asOrganization') ?? undefined
  const evaluationId = searchParams.get('evaluation') ?? undefined
  const tenant = useTenantContext(asOrganization)
  const { officeId, ready, requiresOfficeSelection } = useConcreteOfficeId(asOrganization)
  const [page, setPage] = useState(1)
  // Al cambiar de página la lista vuelve a su encabezado, no se queda en el pie de la anterior.
  const tableRef = useRef<HTMLDivElement>(null)
  const changePage = (next: number) => {
    setPage(next)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    tableRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
  }
  const [pageSize, setPageSize] = useState<number>(RISK_DEFAULT_PAGE_SIZE)
  // El servidor arma y ordena las dos listas con un orden fijo (contrato §7) y después pagina.
  const [list, setList] = useState<RiskList>('deficiencies')
  // Otra oficina, organización, tamaño o lista tiene sus propias páginas: vuelve a la primera.
  useEffect(() => setPage(1), [officeId, asOrganization, evaluationId, pageSize, list])
  const query = useLatestRisk({
    officeId,
    asOrganization,
    evaluationId,
    page,
    limit: pageSize,
    list,
    enabled: ready,
  })
  const data = query.data?.evaluation
  const calculationMessage =
    !evaluationId && !query.isPending && !query.isError
      ? getRiskCalculationMessage(query.data?.recalculation, Boolean(data))
      : null
  const pagination = query.data?.pagination
  const inventoryHref = portalHref('/portal/inventory', asOrganization)

  if (requiresOfficeSelection)
    return (
      <Stack gap="xl">
        <PageHeader title="Índice de deficiencias" />
        <OfficeRiskSelectionNotice />
      </Stack>
    )

  return (
    <Stack gap="xl">
      {evaluationId && (
        <Alert color="blue" title="Evaluación histórica">
          Esta es la evidencia que originó la tarea. El puntaje vigente puede ser diferente.
        </Alert>
      )}
      <PageHeader
        title="Índice de deficiencias"
        description="Una vista simple de los problemas de seguridad detectados y de la información que todavía falta revisar."
        rightSection={
          data?.id ? (
            <CreateRelatedTaskButton
              reference={{ relationTo: 'risk-evaluations', value: String(data.id) }}
              asOrganization={asOrganization}
            />
          ) : undefined
        }
      />
      <RiskScopeExplanation scope={query.data?.scope} />
      {query.data?.scope === 'assigned_offices' &&
        !data?.id &&
        !query.isPending &&
        !query.isError &&
        tenant.data?.permissions.tasks.includes('create') && (
          <Text size="sm" c="dimmed">
            Selecciona una oficina para crear una tarea relacionada con su evaluación.
          </Text>
        )}
      {query.isError && <Alert color="red">No se pudo cargar la última evaluación.</Alert>}
      {calculationMessage && (
        <Alert color={calculationMessage.color} title={calculationMessage.title}>
          {calculationMessage.message}
        </Alert>
      )}
      {query.isPending ? (
        <Skeleton height={260} />
      ) : !data ? (
        evaluationId && !query.isError ? (
          <Alert color="gray">No se encontró esta evaluación histórica.</Alert>
        ) : null
      ) : (
        <>
          {!indexVisible(data.visibility) && (
            <Alert color="orange" title="Datos insuficientes">
              Completa las revisiones pendientes, identifica dispositivos y mantén activo el agente
              para poder mostrar el índice.
            </Alert>
          )}
          {data.visibility === 'preliminary' && (
            <Alert color="yellow" title="Resultado preliminar">
              La información disponible es menor al 80 %: el índice se muestra como orientación, sin
              banda.
            </Alert>
          )}
          <Card withBorder radius="lg" p="xl">
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
              <Stack gap="md" style={{ minWidth: 0 }}>
                <Text fw={700}>Índice de deficiencias</Text>
                <Flex
                  direction={{ base: 'column', sm: 'row' }}
                  gap="lg"
                  align={{ base: 'center', sm: 'flex-start' }}
                >
                  <RingProgress
                    size={120}
                    thickness={12}
                    style={{ flexShrink: 0 }}
                    // Without a band (preliminary result) the ring stays neutral instead of alarming.
                    sections={[
                      {
                        value: data.index ?? 0,
                        color: data.band ? RISK_BAND_COLOR[data.band] : 'gray',
                      },
                    ]}
                    label={
                      <Text ta="center" fw={800} fz={30}>
                        {data.index === null ? '—' : Math.round(data.index)}
                      </Text>
                    }
                  />
                  <Stack gap="xs" w="100%" style={{ flex: 1, minWidth: 0 }}>
                    {data.band && <RiskBandBadge band={data.band} />}
                    {data.index !== null && !data.band && (
                      <StatusBadge tone="neutral" label="Preliminar" />
                    )}
                    <Text size="sm">
                      {data.index === null
                        ? 'Todavía no hay información suficiente para calcularlo.'
                        : RISK_SCORE_MEANING}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {RISK_SCORE_SCALE}. Cuanto más alto, mayor es la prioridad de mejora.
                    </Text>
                  </Stack>
                </Flex>
              </Stack>
              <Stack gap="md" style={{ minWidth: 0 }}>
                <Group justify="space-between">
                  <Text fw={700}>Información disponible</Text>
                  <Text>{data.coverage === null ? '—' : `${Math.round(data.coverage)}/100`}</Text>
                </Group>
                <Progress value={data.coverage ?? 0} color="pine" />
                <Group justify="space-between">
                  <Text fw={700}>Dispositivos sin identificar</Text>
                  <Text>{data.counts.assets.unidentified}</Text>
                </Group>
                {data.counts.assets.unidentified > 0 && (
                  <Anchor component={Link} href={inventoryHref} size="sm">
                    Identificarlos en el inventario
                  </Anchor>
                )}
                <Text size="sm">
                  Estado del resultado: {RISK_VISIBILITY_LABEL[data.visibility]}
                </Text>
                <Text size="xs" c="dimmed">
                  {data.counts.pairs.not_evaluable} comprobaciones sin información suficiente
                  {data.counts.assets.authorization_pending > 0 &&
                    ` · ${data.counts.assets.authorization_pending} con autorización pendiente`}
                  {data.counts.assets.excluded_from_assessment > 0 &&
                    ` · ${data.counts.assets.excluded_from_assessment} dispositivos fuera de las revisiones`}
                  {data.counts.network.pending_services > 0 &&
                    ` · ${data.counts.network.pending_services} servicios de red pendientes en ${data.counts.network.assets_with_pending_services} equipos`}
                </Text>
              </Stack>
            </SimpleGrid>
          </Card>
          <RiskAlerts evaluation={data} inventoryHref={inventoryHref} />
          <ControlCoverage controls={data.controls} />
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
            <Tabs value={list} onChange={value => value && setList(value as RiskList)} mb="md">
              <Tabs.List>
                <Tabs.Tab
                  value="deficiencies"
                  leftSection={<ShieldAlert size={16} strokeWidth={1.5} />}
                >
                  Deficiencias ({query.data?.totals.deficiencies ?? 0})
                </Tabs.Tab>
                <Tabs.Tab
                  value="pending"
                  leftSection={<ClipboardList size={16} strokeWidth={1.5} />}
                >
                  Pendientes ({query.data?.totals.pending ?? 0})
                </Tabs.Tab>
              </Tabs.List>
            </Tabs>
            <Text size="sm" c="dimmed" mb="md">
              {list === 'deficiencies'
                ? 'Lo que no cumple, de mayor a menor prioridad. Abre cada fila para ver los motivos, incluidas las mejoras de prioridad baja.'
                : 'Información que falta o que hay que revisar. No tiene prioridad: completa primero el estado del relevamiento.'}
            </Text>
            {/* Sólo la carga de otra página/tamaño (datos de relleno), no el refresco de fondo de
                cada 30 s: si no, la lista se atenuaba sola periódicamente. La key reinicia los
                ítems abiertos al cambiar de página, lista o alcance. */}
            <RiskItemList
              key={`${list}|${page}|${pageSize}|${officeId ?? ''}|${asOrganization ?? ''}|${evaluationId ?? ''}`}
              list={list}
              items={query.data?.list === list ? query.data.items : []}
              isLoading={query.isPending || query.isPlaceholderData}
              asOrganization={asOrganization}
            />
            {pagination && pagination.totalDocs > RISK_PAGE_SIZES[0] && (
              <Group justify="space-between" mt="md">
                <Group gap="sm">
                  <Text size="sm" c="dimmed">
                    {pagination.totalDocs} {list === 'deficiencies' ? 'deficiencias' : 'pendientes'}
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
