'use client'

import { Alert, Button, Group, Stack } from '@mantine/core'
import { Info, RefreshCw } from 'lucide-react'
import { BackButton } from './BackButton'
import { resourceErrorMessage } from '@/lib/resource-error'

export function ResourceError({
  error,
  resource,
  backHref,
  backLabel,
  onRetry,
  retrying = false,
}: {
  error: unknown
  resource: string
  backHref: string
  backLabel: string
  onRetry: () => void
  retrying?: boolean
}) {
  const message = resourceErrorMessage(error, resource)
  return (
    <Stack gap="md">
      <BackButton href={backHref} label={backLabel} fullWidth="always" variant="outline" />
      <Alert
        color={message.retryable ? 'red' : 'pine'}
        title={message.title}
        icon={<Info size={16} strokeWidth={1.5} />}
      >
        {message.description}
      </Alert>
      {message.retryable && (
        <Group gap="sm">
          <Button
            variant="default"
            leftSection={<RefreshCw size={16} strokeWidth={1.5} />}
            onClick={onRetry}
            loading={retrying}
          >
            Reintentar
          </Button>
        </Group>
      )}
    </Stack>
  )
}
