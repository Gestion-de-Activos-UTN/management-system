import { Text, type TextProps } from '@mantine/core';
import type { ReactNode } from 'react';

/**
 * Technical/identifying data — IPs, hostnames, asset/org ids — renders in the
 * theme's monospace face (lib/theme.ts). The one deliberate typographic
 * signature of an inventory/compliance tool: identifiers read as data, not
 * prose. Generic, zero domain knowledge — any module reaches for this.
 */
export function TechnicalText({ children, ...props }: TextProps & { children: ReactNode }) {
  return (
    <Text ff="monospace" size="sm" {...props}>
      {children}
    </Text>
  );
}
