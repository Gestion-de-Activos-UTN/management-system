import { Badge, VisuallyHidden } from '@mantine/core'
import type { ReactNode } from 'react'

const TONE_COLOR = {
  success: 'green',
  warning: 'yellow',
  danger: 'red',
  info: 'pine',
  neutral: 'bone',
} as const

export type StatusTone = keyof typeof TONE_COLOR

/**
 * Generic tone → color badge, zero domain knowledge (SYSTEM_PROMPT.md #3).
 * Domain modules wrap this for meaning-specific badges, e.g.
 * modules/assets/components/CriticalityBadge.tsx maps
 * criticality -> tone and renders <StatusBadge tone={...} label={...} />.
 *
 * Uses the theme's default Badge variant ("filled", see lib/theme.ts) —
 * "light" reads too close-in-hue between tones (e.g. green vs yellow) in
 * dark mode; a solid, autoContrast-text fill stays legible in both schemes.
 */
export function StatusBadge({
  tone,
  label,
  size,
  icon,
  iconOnly = false,
}: {
  tone: StatusTone
  label: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  icon?: ReactNode
  iconOnly?: boolean
}) {
  return (
    <Badge
      color={TONE_COLOR[tone]}
      size={size}
      style={{
        display: 'inline-flex',
        width: 'fit-content',
        maxWidth: '100%',
      }}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      {iconOnly && icon ? <VisuallyHidden>{label}</VisuallyHidden> : label}
    </Badge>
  )
}
