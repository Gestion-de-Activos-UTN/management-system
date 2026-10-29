import { Badge, VisuallyHidden } from '@mantine/core'
import type { ReactNode } from 'react'

export const STATUS_TONE_COLOR = {
  success: 'green',
  warning: 'yellow',
  danger: 'red',
  info: 'pine',
  neutral: 'bone',
} as const

export type StatusTone = keyof typeof STATUS_TONE_COLOR

/**
 * Generic tone → color badge, zero domain knowledge (SYSTEM_PROMPT.md #3).
 * Domain modules wrap this for meaning-specific badges, e.g.
 * modules/assets/components/CriticalityBadge.tsx maps
 * criticality -> tone and renders <StatusBadge tone={...} label={...} />.
 *
 * Uses the theme's filled variant. globals.css softens filled badges in dark mode
 * while preserving their text labels and semantic colors.
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
      color={STATUS_TONE_COLOR[tone]}
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
