'use client'

import { forwardRef } from 'react'
import { Box, Group, Text, Textarea, type TextareaProps } from '@mantine/core'

type CharacterCountTextareaProps = Omit<TextareaProps, 'description' | 'maxLength' | 'value'> & {
  description?: string
  maxLength: number
  value: string
}

export const CharacterCountTextarea = forwardRef<
  HTMLTextAreaElement,
  CharacterCountTextareaProps
>(function CharacterCountTextarea({ description, maxLength, value, ...props }, ref) {
  return (
    <Textarea
      {...props}
      ref={ref}
      value={value}
      maxLength={maxLength}
      description={
        <Group component="span" gap="xs" justify="space-between" wrap="nowrap">
          <Box component="span" style={{ minWidth: 0, flex: 1 }}>
            {description}
          </Box>
          <Text
            component="span"
            size="xs"
            c="dimmed"
            style={{ flexShrink: 0 }}
            aria-label={`${value.length} de ${maxLength} caracteres`}
          >
            {value.length}/{maxLength}
          </Text>
        </Group>
      }
    />
  )
})
