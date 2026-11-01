'use client'

import Link from 'next/link'
import { ActionIcon, Group, Tooltip } from '@mantine/core'
import { Eye } from 'lucide-react'
import type { Asset } from '@/app/types/payload-types'
import { usePortalHref } from '@/lib/use-portal-href'
import { useSearchParams } from 'next/navigation'
import { CreateRelatedTaskButton } from '@/modules/tasks/components/CreateRelatedTaskButton'

// Componente aparte (no una cell inline) porque necesita su propio hook — una
// función cell plana de TanStack Table no puede llamar hooks de React.
export function RowActions({ asset }: { asset: Asset }) {
  const href = usePortalHref()
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  return (
    <Group gap={6} wrap="wrap" justify="center">
      <Tooltip label="Ver detalles">
        <ActionIcon
          component={Link}
          href={href(`/portal/inventory/${asset.id}`)}
          variant="light"
          size="md"
          aria-label="Ver detalles"
        >
          <Eye size={16} strokeWidth={1.5} />
        </ActionIcon>
      </Tooltip>
      {asset.status !== 'retired' && !asset.deleted_at && (
        <CreateRelatedTaskButton
          compact
          reference={{ relationTo: 'assets', value: String(asset.id) }}
          asOrganization={asOrganization}
        />
      )}
    </Group>
  )
}
