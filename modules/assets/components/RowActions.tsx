'use client';

import Link from 'next/link';
import { ActionIcon, Group, Tooltip } from '@mantine/core';
import { BadgeCheck, Eye } from 'lucide-react';
import type { Asset } from '@/app/types/payload-types';
import { useIdentifyAsset } from '../hooks/use-identify-asset';

// Componente aparte (no una cell inline) porque necesita su propio hook de mutación — una
// función cell plana de TanStack Table no puede llamar hooks de React.
export function RowActions({ asset }: { asset: Asset }) {
  const identify = useIdentifyAsset();

  return (
    <Group gap={4} wrap="nowrap">
      <Tooltip label="View details">
        <ActionIcon component={Link} href={`/portal/inventory/${asset.id}`} variant="light" size="md">
          <Eye size={16} strokeWidth={1.5} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={asset.identified ? 'Mark as not identified' : 'Identify'}>
        <ActionIcon
          variant="light"
          color="pine"
          size="md"
          loading={identify.isPending}
          onClick={() => identify.mutate({ id: asset.id, identified: !asset.identified })}
        >
          <BadgeCheck size={16} strokeWidth={1.5} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
