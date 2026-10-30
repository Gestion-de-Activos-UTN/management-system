'use client'

import { useEffect, useRef, useState } from 'react'
import { Text, Tooltip, type TextProps } from '@mantine/core'

/** One line with its full value available on hover/focus only when actually truncated. */
export function OneLineText({
  children,
  size = 'sm',
  style,
  ...props
}: Omit<TextProps, 'children' | 'truncate'> & { children: string | null | undefined }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [truncated, setTruncated] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setTruncated(element.scrollWidth > element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [children])

  return (
    <Tooltip label={children} disabled={!truncated || !children}>
      <Text
        {...props}
        ref={ref}
        size={size}
        c={props.c ?? (children ? undefined : 'dimmed')}
        truncate
        tabIndex={truncated ? 0 : undefined}
        style={[{ minWidth: 0, maxWidth: '100%' }, style]}
      >
        {children || '—'}
      </Text>
    </Tooltip>
  )
}
