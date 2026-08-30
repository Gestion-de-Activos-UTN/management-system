'use client'

import { useSearchParams } from 'next/navigation'
import { Card, Group, RingProgress, Skeleton, Stack, Text } from '@mantine/core'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { useLatestSnapshot } from '@/modules/inventory-snapshots/hooks/use-latest-snapshot'
import { formatDateTime } from '@/lib/format-date'

type RiskRow = { category: string; score: number; trend: string }

// ponytail: el desglose por categoría sigue siendo placeholder — esa granularidad no existe en
// el modelo de datos (InventorySnapshot.risk_score solo tiene `global`, ver
// documentation/05-inventory-architecture.md §5.2). Reemplazar cuando el algoritmo real de
// risk score (fuera de alcance, RF-30) defina categorías. El número principal (RingProgress)
// ya no es fake: viene de InventorySnapshots.risk_score.global del snapshot más reciente.
const FAKE_ROWS: RiskRow[] = [
  { category: 'Network exposure', score: 68, trend: 'flat' },
  { category: 'Patch hygiene', score: 74, trend: 'up' },
  { category: 'Access control', score: 81, trend: 'up' },
  { category: 'Endpoint coverage', score: 65, trend: 'down' },
]

const columns: ColumnDef<RiskRow, unknown>[] = [
  { accessorKey: 'category', header: 'Category' },
  { accessorKey: 'score', header: 'Score' },
  { accessorKey: 'trend', header: 'Trend' },
]

export default function RiskScorePage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const { data: latestSnapshot, isPending } = useLatestSnapshot(asOrganization)

  return (
    <Stack gap="md">
      <PageHeader
        title="Risk Score"
        description="How your organization scores across key categories."
      />
      <Card
        withBorder
        padding="sm"
        style={{
          borderColor: 'var(--mantine-color-yellow-6)',
          background:
            'repeating-linear-gradient(135deg, var(--mantine-color-yellow-1) 0 16px, var(--mantine-color-yellow-2) 16px 32px)',
        }}
      >
        <Group
          justify="center"
          gap="sm"
          wrap="wrap"
          py="xs"
          style={{
            borderTop: '2px solid var(--mantine-color-yellow-8)',
            borderBottom: '2px solid var(--mantine-color-yellow-8)',
            textTransform: 'uppercase',
            letterSpacing: '0.16em',
            fontWeight: 800,
            color: 'var(--mantine-color-yellow-9)',
          }}
        >
          <Text size="sm" fw={800}>
            Fake data //
          </Text>
          <Text size="sm" fw={800}>
            Fake data //
          </Text>
          <Text size="sm" fw={800}>
            Fake data //
          </Text>
          <Text size="sm" fw={800}>
            Fake data
          </Text>
        </Group>
      </Card>
      <Card withBorder padding="lg">
        {isPending ? (
          <Skeleton height={120} circle />
        ) : latestSnapshot ? (
          <Group align="flex-start" wrap="wrap">
            <RingProgress
              size={120}
              thickness={12}
              sections={[{ value: latestSnapshot.risk_score.global, color: 'pine' }]}
              label={
                <Text ta="center" fw={700}>
                  {latestSnapshot.risk_score.global}
                </Text>
              }
            />
            <Text c="dimmed">
              Overall risk score, from the snapshot taken on{' '}
              {formatDateTime(latestSnapshot.taken_at)}.
            </Text>
          </Group>
        ) : (
          <Text c="dimmed">No snapshot has been generated yet for this office/organization.</Text>
        )}
      </Card>
      <DataTable columns={columns} data={FAKE_ROWS} isLoading={isPending} minWidth={640} />
    </Stack>
  )
}
