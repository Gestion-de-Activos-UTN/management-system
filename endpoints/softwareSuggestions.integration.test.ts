import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPayload } from 'payload'
import type { Payload, PayloadRequest } from 'payload'
import config from '../payload.config'
import { softwareSuggestionsEndpoint } from './softwareSuggestions'

function request(payload: Payload, userId?: string) {
  return {
    payload,
    user: userId ? { id: userId, collection: 'users' } : undefined,
    context: {},
    json: async () => ({}),
  } as unknown as PayloadRequest
}

type SeededAsset = {
  alias: string
  asset_category: 'software_license' | 'antivirus_edr' | 'printer'
  software_vendor?: string
  software_product?: string
}

// Los detalles de software se escriben directamente en el grupo de la Collection: con
// overrideAccess y sin `req`, resolveTenantAndReview corta en `if (!ctx) return data` y no los
// deriva — por eso este seed también pasa `organization` a mano.
async function seedOrganization(payload: Payload, label: string, assets: SeededAsset[]) {
  const organization = await payload.create({
    collection: 'organizations',
    overrideAccess: true,
    data: { name: `Software suggestions ${label} ${Math.random()}` },
  })
  const office = await payload.create({
    collection: 'offices',
    overrideAccess: true,
    data: { organization: organization.id, name: 'Main Office' },
  })
  const user = await payload.create({
    collection: 'users',
    overrideAccess: true,
    data: {
      name: `Suggestions owner ${label}`,
      email: `suggestions-${Math.random().toString(36).slice(2)}@test.local`,
      password: 'x'.repeat(12),
    },
  })
  const roleResult = await payload.find({
    collection: 'roles',
    where: { slug: { equals: 'org_admin' } },
    overrideAccess: true,
    limit: 1,
  })
  const role =
    roleResult.docs[0] ??
    (await payload.create({
      collection: 'roles',
      overrideAccess: true,
      data: {
        name: 'Organization administrator',
        slug: 'org_admin',
        rank: 2,
        scope: 'organization',
        is_platform_role: false,
      },
    }))
  await payload.create({
    collection: 'organization-memberships',
    overrideAccess: true,
    data: {
      user: user.id,
      organization: organization.id,
      offices: [office.id],
      role: role.id,
      status: 'active',
      is_active: true,
    },
  })
  for (const asset of assets) {
    await payload.create({
      collection: 'non-network-assets',
      overrideAccess: true,
      data: {
        alias: asset.alias,
        asset_category: asset.asset_category,
        criticality: 'medium',
        owner: user.id,
        office: office.id,
        organization: organization.id,
        status: 'active',
        review_interval: 'never',
        product_details:
          asset.software_vendor || asset.software_product
            ? {
                software_vendor: asset.software_vendor ?? null,
                software_product: asset.software_product ?? null,
                software_version: null,
              }
            : undefined,
      },
    })
  }
  return { organization, office, user }
}

const ACME_ASSETS: SeededAsset[] = [
  {
    alias: 'Acrobat Ventas',
    asset_category: 'software_license',
    software_vendor: 'Adobe',
    software_product: 'Acrobat Reader',
  },
  // Mismo par que el anterior: es el caso que la feature existe para resolver, y acá verifica
  // que el endpoint lo devuelva una sola vez.
  {
    alias: 'Acrobat Administración',
    asset_category: 'software_license',
    software_vendor: 'Adobe',
    software_product: 'Acrobat Reader',
  },
  {
    alias: 'Antivirus de la red',
    asset_category: 'antivirus_edr',
    software_vendor: 'ESET',
    software_product: 'Endpoint Security',
  },
  // Sin identificación de software: no tiene que aparecer en ninguna de las dos listas.
  { alias: 'Impresora del hall', asset_category: 'printer' },
]

test('sugerencias: deduplica, ordena e ignora los activos sin software', async () => {
  const payload = await getPayload({ config })
  const { user } = await seedOrganization(payload, 'acme', ACME_ASSETS)

  const response = await softwareSuggestionsEndpoint.handler(request(payload, String(user.id)))
  const body = (await (response as Response).json()) as { vendors: string[]; products: string[] }

  assert.deepEqual(body.vendors, ['Adobe', 'ESET'])
  assert.deepEqual(body.products, ['Acrobat Reader', 'Endpoint Security'])
})

test('sugerencias: nunca devuelve valores de otra organización', async () => {
  const payload = await getPayload({ config })
  const [acme, other] = await Promise.all([
    seedOrganization(payload, 'acme', ACME_ASSETS),
    seedOrganization(payload, 'rival', [
      {
        alias: 'Antivirus del rival',
        asset_category: 'antivirus_edr',
        software_vendor: 'Kaspersky',
        software_product: 'Total Security',
      },
    ]),
  ])

  const response = await softwareSuggestionsEndpoint.handler(
    request(payload, String(acme.user.id))
  )
  const body = (await (response as Response).json()) as { vendors: string[]; products: string[] }

  assert.ok(!body.vendors.includes('Kaspersky'))
  assert.ok(!body.products.includes('Total Security'))

  // Y al revés, para descartar que el aislamiento sea un efecto del orden de creación.
  const rivalResponse = await softwareSuggestionsEndpoint.handler(
    request(payload, String(other.user.id))
  )
  const rivalBody = (await (rivalResponse as Response).json()) as { vendors: string[] }
  assert.deepEqual(rivalBody.vendors, ['Kaspersky'])
})

// Fail-closed: sin sesión no hay identidad que resolver y el endpoint no puede filtrar nada.
test('sugerencias: sin sesión responde 401', async () => {
  const payload = await getPayload({ config })

  const response = (await softwareSuggestionsEndpoint.handler(request(payload))) as Response

  assert.equal(response.status, 401)
})
