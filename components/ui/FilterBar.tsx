import type { ReactNode } from 'react'
import { SimpleGrid } from '@mantine/core'

/**
 * Grilla única para filtros de listados. Los controles van sin `label` (sólo placeholder /
 * `aria-label`), con `w="100%"`, y los Select arrancan con una opción explícita "Todas/Todos
 * los …" en lugar de `clearable` — ver SYSTEM_PROMPT.md §3 (UI patterns).
 */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="sm" style={{ flex: 1 }}>
      {children}
    </SimpleGrid>
  )
}
