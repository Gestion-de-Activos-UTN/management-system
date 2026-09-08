import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getPayload } from 'payload'
import type { Payload } from 'payload'
import config from '../../payload.config'
import { createInventorySnapshot } from './createInventorySnapshot'
import { relationId } from '@/lib/relationId'

// Integration test real contra Postgres (ver endpoints/reports.integration.test.ts para el
// mismo criterio) — el foco acá es la garantía de copia-por-valor de assets_dump, que un mock
// de Payload no puede probar de forma creíble (el riesgo real es cómo Payload devuelve sus docs).

async function seedOfficeWithAssets(payload: Payload) {
  const organization = await payload.create({
    collection: 'organizations',
    data: { name: `Org ${Math.random()}` },
    overrideAccess: true,
  })
  await payload.create({
    collection: 'organization-settings',
    data: {
      organization: organization.id,
      industry: 'Professional services',
      assessment_policy_key: 'essential',
      assessment_policy_version: 1,
      assessment_policy_selected_at: new Date().toISOString(),
    },
    overrideAccess: true,
  })
  const office = await payload.create({
    collection: 'offices',
    data: { organization: organization.id, name: 'Oficina Test' },
    overrideAccess: true,
  })
  const agent = await payload.create({
    collection: 'agents',
    data: { id: `agent-${Math.random().toString(36).slice(2)}`, office: office.id },
    overrideAccess: true,
  })
  const user = await payload.create({
    collection: 'users',
    overrideAccess: true,
    data: {
      email: `owner-${Math.random().toString(36).slice(2)}@test.com`,
      password: 'x'.repeat(12),
      name: 'Owner Test',
    },
  })

  const criticalAsset = await payload.create({
    collection: 'assets',
    overrideAccess: true,
    // status: 'offline' es autoridad de ingesta/aging (rejectManualOfflineStatus.ts) — el seed
    // necesita el mismo `context.systemJob` que esos procesos para poder sembrarlo directo.
    context: { systemJob: true },
    data: {
      asset_id: `a-${Math.random().toString(36).slice(2)}`,
      agent: agent.id,
      office: office.id,
      organization: organization.id,
      ip: '10.0.0.1',
      criticality: 'critical',
      status: 'offline',
      identified: true,
    },
  })
  await payload.create({
    collection: 'assets',
    overrideAccess: true,
    context: { systemJob: true },
    data: {
      asset_id: `a-${Math.random().toString(36).slice(2)}`,
      agent: agent.id,
      office: office.id,
      organization: organization.id,
      ip: '10.0.0.2',
      criticality: 'low',
      status: 'active',
      identified: true,
    },
  })

  const nonNetworkAsset = await payload.create({
    collection: 'non-network-assets',
    overrideAccess: true,
    data: {
      alias: 'Backup mensual',
      asset_category: 'backup',
      criticality: 'high',
      owner: user.id,
      office: office.id,
      organization: organization.id,
      status: 'active',
      review_interval: 'never',
    },
  })

  return { organization, office, user, criticalAsset, nonNetworkAsset }
}

test('createInventorySnapshot: freezes inventory and an independently calculated risk summary', async () => {
  const payload = await getPayload({ config })
  const { office, user } = await seedOfficeWithAssets(payload)

  const snapshot = await createInventorySnapshot(payload, String(office.id), {
    type: 'manual',
    userId: String(user.id),
  })

  assert.equal(snapshot.generated_by, 'manual')
  const dump = snapshot.assets_dump as { network: unknown[]; non_network: unknown[] }
  assert.equal(dump.network.length, 2, 'debe incluir los 2 Assets de red')
  assert.equal(dump.non_network.length, 1, 'debe incluir el NonNetworkAsset manual (RF-49-54)')
  const risk = snapshot.risk_score as { global: number | null; evaluated_percentage: number }
  assert.equal(risk.global, null, 'sin resultados evaluables el riesgo no debe aparentar cero')
  assert.equal(risk.evaluated_percentage, 0)
  assert.ok(snapshot.assessment_results_snapshot)
})

test('createInventorySnapshot: an unidentified asset is visible without becoming fabricated risk', async () => {
  const payload = await getPayload({ config })
  const { office, user } = await seedOfficeWithAssets(payload)

  // Sin identificar (identified: false, default): queda visible en el inventario, pero no existe
  // evidencia suficiente para convertirlo por sí solo en cumplimiento o incumplimiento.
  await payload.create({
    collection: 'assets',
    overrideAccess: true,
    context: { systemJob: true },
    data: {
      asset_id: `a-${Math.random().toString(36).slice(2)}`,
      agent: (
        await payload.find({
          collection: 'agents',
          where: { office: { equals: office.id } },
          overrideAccess: true,
          limit: 1,
        })
      ).docs[0].id,
      office: office.id,
      organization: relationId(office.organization),
      ip: '10.0.0.3',
      criticality: 'critical',
      status: 'offline',
    },
  })

  const snapshot = await createInventorySnapshot(payload, String(office.id), {
    type: 'manual',
    userId: String(user.id),
  })

  const dump = snapshot.assets_dump as { network: unknown[] }
  assert.equal(dump.network.length, 3, 'el no-identificado sigue en el dump')
  assert.equal((snapshot.risk_score as { global: number | null }).global, null)
})

test('createInventorySnapshot: assets_dump es una copia por valor, no una referencia viva', async () => {
  const payload = await getPayload({ config })
  const { office, criticalAsset, nonNetworkAsset } = await seedOfficeWithAssets(payload)

  const snapshot = await createInventorySnapshot(payload, String(office.id), { type: 'scheduled' })

  // Cambiar el Asset y el NonNetworkAsset reales después del snapshot no debe alterar lo ya persistido.
  await payload.update({
    collection: 'assets',
    id: criticalAsset.id,
    overrideAccess: true,
    data: { status: 'active' },
  })
  await payload.update({
    collection: 'non-network-assets',
    id: nonNetworkAsset.id,
    overrideAccess: true,
    data: { status: 'retired' },
  })

  const reread = await payload.findByID({
    collection: 'inventory-snapshots',
    id: snapshot.id,
    overrideAccess: true,
    depth: 0,
  })
  const dump = reread.assets_dump as {
    network: Array<{ id: string; status: string }>
    non_network: Array<{ id: string; status: string }>
  }
  const dumpedCritical = dump.network.find(a => a.id === criticalAsset.id)
  const dumpedNonNetwork = dump.non_network.find(a => a.id === nonNetworkAsset.id)
  assert.equal(
    dumpedCritical?.status,
    'offline',
    'el dump no debe seguir el estado actual del Asset'
  )
  assert.equal(
    dumpedNonNetwork?.status,
    'active',
    'el dump no debe seguir el estado actual del NonNetworkAsset'
  )
})
