'use client';

import { Card, Group, RingProgress, Skeleton, Stack, Text } from '@mantine/core';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { useFakeLoading } from '@/lib/use-fake-loading';

type RiskRow = { category: string; score: number; trend: string };

// ponytail: static placeholder — wire to a real risk-score domain once that backend ships.
const FAKE_SCORE = 72;
const FAKE_ROWS: RiskRow[] = [
  { category: 'Network exposure', score: 68, trend: 'flat' },
  { category: 'Patch hygiene', score: 74, trend: 'up' },
  { category: 'Access control', score: 81, trend: 'up' },
  { category: 'Endpoint coverage', score: 65, trend: 'down' },
];

const columns: ColumnDef<RiskRow, unknown>[] = [
  { accessorKey: 'category', header: 'Category' },
  { accessorKey: 'score', header: 'Score' },
  { accessorKey: 'trend', header: 'Trend' },
];

export default function RiskScorePage() {
  const loading = useFakeLoading(500);

  return (
    <Stack gap="md">
      <PageHeader title="Risk Score" description="How your organization scores across key categories." />
      <Card withBorder padding="lg">
        {loading ? (
          <Skeleton height={120} circle />
        ) : (
          <Group>
            <RingProgress
              size={120}
              thickness={12}
              sections={[{ value: FAKE_SCORE, color: 'pine' }]}
              label={
                <Text ta="center" fw={700}>
                  {FAKE_SCORE}
                </Text>
              }
            />
            <Text c="dimmed">Overall risk score, aggregated across offices.</Text>
          </Group>
        )}
      </Card>
      <DataTable columns={columns} data={FAKE_ROWS} isLoading={loading} />
    </Stack>
  );
}
