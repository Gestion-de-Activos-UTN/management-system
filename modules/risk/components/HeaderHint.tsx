import type { ReactNode } from 'react'
import { Box, Group, Text, Tooltip } from '@mantine/core'
import { Info } from 'lucide-react'

const TOOLTIP_EVENTS = { hover: true, focus: true, touch: true }

/** Ayuda de lectura reutilizable: también se abre con foco y con un toque (sin hover). */
export function Hint({ hint, children }: { hint: string; children: ReactNode }) {
  return (
    <Tooltip multiline w={280} label={hint} events={TOOLTIP_EVENTS}>
      {children}
    </Tooltip>
  )
}

/** Encabezado con ícono de ayuda. Nunca dentro de un Accordion.Control (es un botón). */
export function HeaderHint({ label, hint }: { label: string; hint: string }) {
  return (
    <Group gap={4} wrap="nowrap">
      <Text span inherit>
        {label}
      </Text>
      <Hint hint={hint}>
        {/* Same plain icon as SecurityReviewOverview; focusable so keyboard and touch reach it. */}
        <Box
          component="span"
          tabIndex={0}
          role="img"
          aria-label={`Qué es ${label.toLowerCase()}`}
          c="dimmed"
          style={{ display: 'inline-flex', cursor: 'help' }}
        >
          <Info size={13} strokeWidth={1.75} />
        </Box>
      </Hint>
    </Group>
  )
}
