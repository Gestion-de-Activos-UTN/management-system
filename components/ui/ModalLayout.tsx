'use client'

import type { ReactNode } from 'react'
import { Box, Stack, type StackProps } from '@mantine/core'
import classes from './ModalLayout.module.css'

/** Keep actions visible while only the dialog's fields/content scroll. Stays inside its form. */
export function ModalLayout({
  children,
  footer,
  gap = 'md',
}: {
  children: ReactNode
  footer: ReactNode
  gap?: StackProps['gap']
}) {
  return (
    <Box className={classes.layout}>
      <Box className={classes.scrollContent}>
        <Stack gap={gap}>{children}</Stack>
      </Box>
      <Box className={classes.footer}>{footer}</Box>
    </Box>
  )
}
