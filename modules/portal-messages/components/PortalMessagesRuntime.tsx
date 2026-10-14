'use client'

import { useEffect, useRef, useState } from 'react'
import { useSession } from '@/lib/use-session'
import { usePortalMessageReceipt, usePortalMessages } from '../hooks/use-portal-messages'
import { usePortalMessageActions } from '../hooks/use-portal-message-actions'
import { PortalMessageDialog } from './PortalMessageDialog'
import {
  isPortalMessageQueueStoppedThisSession,
  markPortalMessageShown,
  resetPortalMessageSessionState,
  stopPortalMessageQueueThisSession,
  wasPortalMessageShownThisSession,
} from '../session-state'

export function PortalMessagesRuntime() {
  const session = useSession()
  const query = usePortalMessages(session?.collection === 'users')
  const receipt = usePortalMessageReceipt()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [queuePaused, setQueuePaused] = useState(false)
  const [queuePosition, setQueuePosition] = useState(1)
  const [queueTotal, setQueueTotal] = useState(0)
  const seenIds = useRef(new Set<string>())
  const message = query.data?.find(item => item.id === activeId) ?? null

  useEffect(() => {
    if (session === null) {
      seenIds.current.clear()
      setQueuePaused(false)
      resetPortalMessageSessionState()
    }
  }, [session])

  useEffect(() => {
    if (activeId || queuePaused || isPortalMessageQueueStoppedThisSession() || !query.data) return
    const pending = query.data.filter(
      item => !item.dismissed && !wasPortalMessageShownThisSession(item.id, item.delivery_version)
    )
    const next = pending[0]
    if (next) {
      if (queueTotal === 0) setQueueTotal(pending.length)
      markPortalMessageShown(next.id, next.delivery_version)
      setActiveId(next.id)
    }
  }, [activeId, queuePaused, query.data, queueTotal])

  useEffect(() => {
    if (!message) return
    const receiptKey = `${message.id}:${message.delivery_version}`
    if (message.seen || seenIds.current.has(receiptKey)) return
    seenIds.current.add(receiptKey)
    receipt.mutate({
      id: message.id,
      status: 'seen',
      deliveryVersion: message.delivery_version,
    })
  }, [message?.id, message?.delivery_version, message?.seen])

  // Al vaciarse la cola se reinicia el contador: un mensaje que llegue después por el
  // polling abre una cola nueva ("1 de n") en lugar de continuar la anterior.
  const endQueue = () => {
    setActiveId(null)
    setQueuePosition(1)
    setQueueTotal(0)
  }

  const advance = (options?: { stopQueue?: boolean }) => {
    if (options?.stopQueue) {
      endQueue()
      stopPortalMessageQueueThisSession()
      setQueuePaused(true)
      return
    }
    const next = query.data?.find(
      item =>
        item.id !== activeId &&
        !item.dismissed &&
        !wasPortalMessageShownThisSession(item.id, item.delivery_version)
    )
    if (next) {
      markPortalMessageShown(next.id, next.delivery_version)
      setActiveId(next.id)
      setQueuePosition(position => position + 1)
    } else {
      endQueue()
    }
  }
  const actions = usePortalMessageActions(message, advance)

  return (
    <PortalMessageDialog
      message={message}
      opened={Boolean(message) && !queuePaused}
      onClose={actions.close}
      onAcknowledge={() => void actions.acknowledge()}
      onRemindLater={actions.remindLater}
      onNoThanks={() => void actions.noThanks()}
      onAction={() => void actions.primaryAction()}
      loadingNoThanks={actions.busy === 'no_thanks'}
      loadingPrimary={actions.busy === 'primary'}
      queuePosition={queuePosition}
      queueTotal={queueTotal}
    />
  )
}
