import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getPayload } from 'payload'
import type { Payload } from 'payload'
import config from '../../payload.config'
import { fetchOfflineAfterHours, DEFAULT_OFFLINE_AFTER_HOURS } from './agingSweep'

async function seedOrg(payload: Payload) {
  return payload.create({
    collection: 'organizations',
    data: { name: `Org ${Math.random()}` },
    overrideAccess: true,
  })
}

// Limpia app-settings antes de cada test: al ser un singleton sin unique constraint propio,
// tests anteriores que crean un documento contaminarían los siguientes si no se resetea.
async function clearAppSettings(payload: Payload) {
  const existing = await payload.find({
    collection: 'app-settings',
    overrideAccess: true,
    limit: 100,
  })
  for (const doc of existing.docs) {
    await payload.delete({ collection: 'app-settings', id: doc.id, overrideAccess: true })
  }
}

test('fetchOfflineAfterHours: sin override de org ni AppSettings, usa la constante', async () => {
  const payload = await getPayload({ config })
  await clearAppSettings(payload)
  const org = await seedOrg(payload)

  const result = await fetchOfflineAfterHours(payload, String(org.id))
  assert.equal(result, DEFAULT_OFFLINE_AFTER_HOURS)
})

test('fetchOfflineAfterHours: sin override de org, usa el default de AppSettings', async () => {
  const payload = await getPayload({ config })
  await clearAppSettings(payload)
  const org = await seedOrg(payload)
  await payload.create({
    collection: 'app-settings',
    data: { default_offline_after_hours: 48 },
    overrideAccess: true,
  })

  const result = await fetchOfflineAfterHours(payload, String(org.id))
  assert.equal(result, 48)
})

test('fetchOfflineAfterHours: el override de la organización gana sobre el default de AppSettings', async () => {
  const payload = await getPayload({ config })
  await clearAppSettings(payload)
  const org = await seedOrg(payload)
  await payload.create({
    collection: 'app-settings',
    data: { default_offline_after_hours: 48 },
    overrideAccess: true,
  })
  await payload.create({
    collection: 'organization-settings',
    data: { organization: org.id, industry: 'Test', offline_after_hours: 24 },
    overrideAccess: true,
  })

  const result = await fetchOfflineAfterHours(payload, String(org.id))
  assert.equal(result, 24)
})
