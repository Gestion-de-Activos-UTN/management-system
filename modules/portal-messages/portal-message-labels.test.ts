import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isInPortalMessageHistory, portalMessageStatus } from './portal-message-labels'

const now = Date.parse('2026-10-11T12:00:00.000Z')
const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString()

describe('portalMessageStatus', () => {
  it('inactivo gana sobre vencido; sin fecha o con fecha futura está vigente', () => {
    assert.equal(portalMessageStatus({ is_active: false, expires_at: daysAgo(1) }, now), 'inactive')
    assert.equal(portalMessageStatus({ is_active: true, expires_at: daysAgo(1) }, now), 'expired')
    assert.equal(portalMessageStatus({ is_active: true, expires_at: daysAgo(-1) }, now), 'active')
    assert.equal(portalMessageStatus({ is_active: true, expires_at: null }, now), 'active')
  })
})

describe('isInPortalMessageHistory', () => {
  it('un mensaje sin leer se muestra siempre, aunque sea antiguo', () => {
    assert.equal(isInPortalMessageHistory({ seen: false, createdAt: daysAgo(90) }, now), true)
  })

  it('uno leído se oculta cuando tiene más de 30 días de antigüedad', () => {
    assert.equal(isInPortalMessageHistory({ seen: true, createdAt: daysAgo(29) }, now), true)
    assert.equal(isInPortalMessageHistory({ seen: true, createdAt: daysAgo(31) }, now), false)
  })
})
