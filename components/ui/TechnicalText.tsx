import { Text, Tooltip, type TextProps } from '@mantine/core';
import type { ReactNode } from 'react';

/**
 * Technical/identifying data — IPs, hostnames, asset/org ids — renders in the
 * theme's monospace face (lib/theme.ts). The one deliberate typographic
 * signature of an inventory/compliance tool: identifiers read as data, not
 * prose. Generic, zero domain knowledge — any module reaches for this.
 *
 * `truncate` clips to the parent's width with an ellipsis and shows the full
 * value in a Tooltip on hover — the parent still needs a bounded width
 * (a fixed column `size`, not just this component) for the ellipsis to kick in.
 */
export function TechnicalText({
  children,
  truncate,
  ...props
}: TextProps & { children: ReactNode; truncate?: boolean }) {
  const text = (
    <Text
      ff="monospace"
      size="sm"
      {...(truncate ? { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, maxWidth: '100%' } } : {})}
      {...props}
    >
      {children}
    </Text>
  );
  return truncate ? <Tooltip label={children}>{text}</Tooltip> : text;
}
