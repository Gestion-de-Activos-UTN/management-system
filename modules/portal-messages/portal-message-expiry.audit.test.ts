import { afterEach, describe, expect, it } from 'vitest'
import { formatDateInput, localDateEndToISOString } from '@/lib/format-date'
import { isInPortalMessageHistory, portalMessageStatus } from './portal-message-labels'

const originalTimeZone = process.env.TZ
afterEach(() => {
  if (originalTimeZone === undefined) delete process.env.TZ
  else process.env.TZ = originalTimeZone
})

// Node reads TZ again when it changes; the system clock is not touched.
describe.each([
  ['America/Argentina/Buenos_Aires', '2026-11-05', '2026-11-06T02:59:59.999Z'],
  ['UTC', '2026-11-05', '2026-11-05T23:59:59.999Z'],
  ['Asia/Tokyo', '2026-11-05', '2026-11-05T14:59:59.999Z'],
  ['America/New_York', '2026-11-01', '2026-11-02T04:59:59.999Z'],
  ['America/New_York', '2026-03-08', '2026-03-09T03:59:59.999Z'],
])('expiry chosen as %s day %s', (timeZone, day, instant) => {
  it('lasts until the last millisecond of that local day', () => {
    process.env.TZ = timeZone
    const expires_at = localDateEndToISOString(day)
    expect(expires_at).toBe(instant)
    const end = Date.parse(instant)
    expect(portalMessageStatus({ is_active: true, expires_at }, end - 1)).toBe('active')
    expect(portalMessageStatus({ is_active: true, expires_at }, end)).toBe('expired')
    expect(formatDateInput(expires_at)).toBe(day)
  })
})

describe('read history', () => {
  const created = '2026-10-01T12:00:00.000Z'
  const limit = Date.parse(created) + 30 * 86_400_000
  it('keeps a read message exactly 30 days after publication and hides it one millisecond later', () => {
    expect(isInPortalMessageHistory({ seen: true, createdAt: created }, limit)).toBe(true)
    expect(isInPortalMessageHistory({ seen: true, createdAt: created }, limit + 1)).toBe(false)
  })
  it('never hides an unread message or one without publication date', () => {
    expect(isInPortalMessageHistory({ seen: false, createdAt: created }, limit + 86_400_000)).toBe(
      true
    )
    expect(isInPortalMessageHistory({ seen: true }, limit + 1)).toBe(true)
  })
})
