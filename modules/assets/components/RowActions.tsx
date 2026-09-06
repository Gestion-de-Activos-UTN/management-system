'use client'

import Link from 'next/link'
import { ActionIcon, Group, Tooltip } from '@mantine/core'
import { Eye } from 'lucide-react'
import type { Asset } from '@/app/types/payload-types'

// Componente aparte (no una cell inline) porque necesita su propio hook de mutación — una
// función cell plana de TanStack Table no puede llamar hooks de React.
export function RowActions({ asset }: { asset: Asset }) {
  return (
    <Group gap={6} wrap="wrap" justify="center">
      <Tooltip label="View details">
        <ActionIcon
          component={Link}
          href={`/portal/inventory/${asset.id}`}
          variant="light"
          size="md"
          aria-label="View details"
        >
          <Eye size={16} strokeWidth={1.5} />
        </ActionIcon>
      </Tooltip>
    </Group>
  )
}
