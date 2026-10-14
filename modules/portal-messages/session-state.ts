const STORAGE_PREFIX = 'portal-message-session:v2:'
const QUEUE_STOPPED_KEY = `${STORAGE_PREFIX}queue-stopped`

export function resetPortalMessageSessionState() {
  if (typeof window === 'undefined') return
  try {
    Object.keys(window.sessionStorage)
      .filter(key => key.startsWith(STORAGE_PREFIX))
      .forEach(key => window.sessionStorage.removeItem(key))
  } catch {
    // The modal queue works without browser storage.
  }
}

export function markPortalMessageShown(id: string, deliveryVersion = 1) {
  try {
    window.sessionStorage.setItem(`${STORAGE_PREFIX}${id}:${deliveryVersion}`, '1')
  } catch {
    // The modal still works if browser storage is unavailable.
  }
}

export function wasPortalMessageShownThisSession(id: string, deliveryVersion = 1) {
  try {
    return window.sessionStorage.getItem(`${STORAGE_PREFIX}${id}:${deliveryVersion}`) === '1'
  } catch {
    return false
  }
}

export function isPortalMessageQueueStoppedThisSession() {
  try {
    return window.sessionStorage.getItem(QUEUE_STOPPED_KEY) === '1'
  } catch {
    return false
  }
}

export function stopPortalMessageQueueThisSession() {
  try {
    window.sessionStorage.setItem(QUEUE_STOPPED_KEY, '1')
  } catch {
    // Queue still stops for the current page if browser storage is unavailable.
  }
}
