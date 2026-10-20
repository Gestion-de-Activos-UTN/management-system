import type { ReactNode } from 'react'
import { SimpleGrid, type SimpleGridProps } from '@mantine/core'

/**
 * Grilla única para filtros de listados. Cada tipo de filtro tiene un solo control: búsqueda
 * (TextInput), varios valores (MultiFilterSelect, con `searchable` si la lista es larga) y
 * binario (SegmentedControl) — ver SYSTEM_PROMPT.md §3, "List filters".
 */
export function FilterBar({
  children,
  cols = { base: 1, sm: 2, lg: 4 },
}: {
  children: ReactNode
  cols?: SimpleGridProps['cols']
}) {
  return (
    <SimpleGrid cols={cols} spacing="sm" style={{ flex: 1 }}>
      {children}
    </SimpleGrid>
  )
}
