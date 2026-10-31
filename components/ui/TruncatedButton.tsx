'use client'

import type { ComponentPropsWithoutRef } from 'react'
import { Button, Tooltip, type ButtonProps } from '@mantine/core'
import { useTextTruncation } from '@/lib/use-text-truncation'

/**
 * Button whose label may not fit (equal-width action rows, narrow screens): the label ends with an
 * ellipsis and the full text appears on hover/focus only when it is actually cut.
 */
export function TruncatedButton({
  children,
  ...props
}: Omit<ButtonProps, 'children'> &
  Omit<ComponentPropsWithoutRef<'button'>, keyof ButtonProps | 'children'> & { children: string }) {
  const { ref, truncated } = useTextTruncation<HTMLSpanElement>(children)
  return (
    <Tooltip label={children} disabled={!truncated}>
      <Button {...props}>
        {/* min-width 0 lets the label shrink inside Mantine's flex label so it can be measured. */}
        <span
          ref={ref}
          style={{
            display: 'block',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {children}
        </span>
      </Button>
    </Tooltip>
  )
}
