'use client';

import { ActionIcon, Group, Tooltip } from '@mantine/core';
import { CheckCheck, Pencil } from 'lucide-react';
import type { NonNetworkAsset } from '@/app/types/payload-types';
import { useMarkReviewed } from '../hooks/use-mark-reviewed';

// Componente aparte (no un cell inline) porque necesita su propio hook de mutación —
// una función cell plana de TanStack Table no puede llamar hooks de React.
export function RowActions({ asset, onEdit }: { asset: NonNetworkAsset; onEdit: (asset: NonNetworkAsset) => void }) {
  const markReviewed = useMarkReviewed();

  return (
    <Group gap={6} wrap="wrap" justify="center">
      <Tooltip label="Edit">
        <ActionIcon variant="light" size="md" aria-label="Edit" onClick={() => onEdit(asset)}>
          <Pencil size={16} strokeWidth={1.5} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={asset.can_review ? 'Mark reviewed' : 'Review opens closer to the due date'}>
        <ActionIcon
          component="span"
          variant="light"
          color="pine"
          size="md"
          loading={markReviewed.isPending}
          disabled={!asset.can_review}
          aria-label={asset.can_review ? 'Mark reviewed' : 'Review opens closer to the due date'}
          onClick={() => asset.can_review && markReviewed.mutate(asset.id)}
        >
          <CheckCheck size={16} strokeWidth={1.5} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
