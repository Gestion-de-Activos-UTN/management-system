'use client'

import { ActionIcon, Group, Tooltip } from '@mantine/core'
import { CheckCheck, Pencil } from 'lucide-react'
import type { NonNetworkAsset } from '@/app/types/payload-types'
import { useMarkReviewed } from '../hooks/use-mark-reviewed'
import { CreateRelatedTaskButton } from '@/modules/tasks/components/CreateRelatedTaskButton'

// Componente aparte (no un cell inline) porque necesita su propio hook de mutación —
// una función cell plana de TanStack Table no puede llamar hooks de React.
export function RowActions({
  asset,
  onEdit,
  asOrganization,
}: {
  asset: NonNetworkAsset
  onEdit: (asset: NonNetworkAsset) => void
  asOrganization?: string
}) {
  const markReviewed = useMarkReviewed()

  return (
    <Group gap={6} wrap="wrap" justify="center">
      <Tooltip label="Editar">
        <ActionIcon variant="light" size="md" aria-label="Editar" onClick={() => onEdit(asset)}>
          <Pencil size={16} strokeWidth={1.5} />
        </ActionIcon>
      </Tooltip>
      <CreateRelatedTaskButton
        compact
        reference={{ relationTo: 'non-network-assets', value: String(asset.id) }}
        asOrganization={asOrganization}
      />
      <Tooltip
        label={
          asset.can_review
            ? 'Marcar como revisado'
            : 'La revisión se habilitará cerca de la fecha de vencimiento'
        }
      >
        <ActionIcon
          component="span"
          variant="light"
          color="pine"
          size="md"
          loading={markReviewed.isPending}
          disabled={!asset.can_review}
          aria-label={
            asset.can_review
              ? 'Marcar como revisado'
              : 'La revisión se habilitará cerca de la fecha de vencimiento'
          }
          onClick={() => asset.can_review && markReviewed.mutate(asset.id)}
        >
          <CheckCheck size={16} strokeWidth={1.5} />
        </ActionIcon>
      </Tooltip>
    </Group>
  )
}
