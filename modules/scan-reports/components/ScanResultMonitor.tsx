'use client'

import { useEffect } from 'react'
import { Button, Group, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { ScanLine } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { formatDateTime } from '@/lib/format-date'
import { useNewScanResult } from '../hooks/use-new-scan-result'
import { invalidateSecurityReview } from '@/modules/assessments/invalidate-security-review'

const NOTIFICATION_ID = 'new-scan-result'

export function ScanResultMonitor({
  organizationId,
  asOrganization,
}: {
  organizationId: string
  asOrganization?: string
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const result = useNewScanResult(organizationId, asOrganization)

  useEffect(() => {
    notifications.hide(NOTIFICATION_ID)
  }, [organizationId])

  useEffect(() => {
    if (!result) return

    queryClient.invalidateQueries({ queryKey: ['assets'] })
    queryClient.invalidateQueries({ queryKey: ['non-network-assets'] })
    invalidateSecurityReview(queryClient)
    queryClient.invalidateQueries({
      predicate: query =>
        query.queryKey[0] === 'scan-reports' && query.queryKey[1] !== 'latest-processed',
    })

    const office =
      typeof result.office === 'object' && result.office ? result.office.name : 'your organization'
    const href = `/portal/inventory${asOrganization ? `?asOrganization=${asOrganization}` : ''}`

    // Una sola notificación global: un resultado posterior reemplaza al anterior. autoClose=false
    // hace que permanezca visible hasta que el usuario la cierre o abra el inventario.
    notifications.hide(NOTIFICATION_ID)
    notifications.show({
      id: NOTIFICATION_ID,
      color: 'pine',
      icon: <ScanLine size={18} strokeWidth={1.5} />,
      title: 'New scan completed',
      autoClose: false,
      withCloseButton: true,
      message: (
        <Stack gap="xs">
          <Text size="sm">
            Results from {office} are ready
            {result.processed_at ? ` · ${formatDateTime(result.processed_at)}` : ''}.
          </Text>
          <Group justify="flex-end">
            <Button
              size="compact-xs"
              variant="light"
              onClick={() => {
                notifications.hide(NOTIFICATION_ID)
                router.push(href)
              }}
            >
              View inventory
            </Button>
          </Group>
        </Stack>
      ),
    })
  }, [result, asOrganization, queryClient, router])

  return null
}
