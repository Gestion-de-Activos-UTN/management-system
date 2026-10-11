'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { notifications } from '@mantine/notifications'
import type { PortalMessageDTO } from '../service'
import { resolvePortalMessageLink } from '../service'
import { usePortalMessageReceipt } from './use-portal-messages'

export function usePortalMessageActions(
  message: PortalMessageDTO | null,
  onDone: (options?: { stopQueue?: boolean }) => void
) {
  const router = useRouter()
  const receipt = usePortalMessageReceipt()
  const [busy, setBusy] = useState<'no_thanks' | 'primary' | null>(null)

  const saveDismissal = async () => {
    if (!message) return false
    try {
      await receipt.mutateAsync({
        id: message.id,
        status: 'dismissed',
        deliveryVersion: message.delivery_version,
      })
      return true
    } catch {
      notifications.show({
        color: 'red',
        message: 'No se pudo guardar la acción. El mensaje podría volver a aparecer.',
      })
      return false
    }
  }

  const acknowledge = async () => {
    if (!message) return
    await saveDismissal()
    onDone()
  }

  const remindLater = () => onDone()

  const noThanks = async () => {
    if (!message) return
    setBusy('no_thanks')
    try {
      await saveDismissal()
    } finally {
      setBusy(null)
      onDone()
    }
  }

  const primaryAction = async () => {
    if (!message) return
    setBusy('primary')
    try {
      const hasLink = Boolean(message.entity)
      const url = hasLink ? await resolvePortalMessageLink(message.id) : null
      await saveDismissal()
      if (hasLink && !url) {
        notifications.show({
          color: 'red',
          message: 'El enlace ya no está disponible o no tienes acceso.',
        })
        onDone({ stopQueue: true })
        return
      }
      if (url) {
        onDone({ stopQueue: true })
        router.push(url)
        return
      }
      onDone({ stopQueue: true })
    } finally {
      setBusy(null)
    }
  }

  return { acknowledge, remindLater, noThanks, primaryAction, busy }
}
