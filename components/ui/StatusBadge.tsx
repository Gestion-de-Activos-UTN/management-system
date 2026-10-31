'use client'

import { Badge, Tooltip, VisuallyHidden } from '@mantine/core'
import { useTextTruncation } from '@/lib/use-text-truncation'
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
  const { ref, truncated } = useTextTruncation<HTMLSpanElement>(label)

  return (
    <Tooltip label={label} disabled={!truncated}>
      <Badge
        tabIndex={truncated ? 0 : undefined}
        color={STATUS_TONE_COLOR[tone]}
        size={size}
        leftSection={icon && !iconOnly ? <span aria-hidden="true">{icon}</span> : undefined}
        style={{
          display: 'inline-flex',
          width: 'fit-content',
          maxWidth: '100%',
        }}
      >
        {iconOnly && icon ? (
          <>
            <span aria-hidden="true">{icon}</span>
            <VisuallyHidden>{label}</VisuallyHidden>
          </>
        ) : (
          <span
            ref={ref}
            style={{
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </span>
        )}
      </Badge>
    </Tooltip>
  )
}
