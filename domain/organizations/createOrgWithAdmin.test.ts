import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Payload, PayloadRequest } from 'payload'
import { createOrgWithAdmin } from './createOrgWithAdmin'

function makePayload(overrides: { roleDocs?: unknown[] } = {}) {
  const calls: string[] = []
  const creates: { collection: string; data: Record<string, unknown> }[] = []
  let nextId = 1
  const transactions: { id: string; committed: boolean; rolledBack: boolean }[] = []

  const payload = {
    db: {
      async beginTransaction() {
        const id = `tx-${transactions.length + 1}`
        transactions.push({ id, committed: false, rolledBack: false })
        calls.push('beginTransaction')
        return id
      },
      async commitTransaction(id: string) {
        calls.push('commitTransaction')
        const tx = transactions.find((t) => t.id === id)
        if (tx) tx.committed = true
      },
      async rollbackTransaction(id: string) {
        calls.push('rollbackTransaction')
        const tx = transactions.find((t) => t.id === id)
        if (tx) tx.rolledBack = true
      },
    },
    async create({
      collection,
      data,
      req,
    }: {
      collection: string
      data: Record<string, unknown>
      req: PayloadRequest
    }) {
      calls.push(`create:${collection}`)
      assert.ok(req.transactionID, `create:${collection} debe correr dentro de una transacción`)
      creates.push({ collection, data })
      return { id: `${collection}-${nextId++}` }
    },
    async update({ collection, req }: { collection: string; req: PayloadRequest }) {
      calls.push(`update:${collection}`)
      assert.ok(req.transactionID, `update:${collection} debe correr dentro de una transacción`)
      return { id: `${collection}-updated` }
    },
    async find({ collection, req }: { collection: string; req: PayloadRequest }) {
      calls.push(`find:${collection}`)
      assert.ok(req.transactionID, `find:${collection} debe correr dentro de una transacción`)
      return { docs: overrides.roleDocs ?? [{ id: 'role-org-admin', slug: 'org_admin' }] }
    },
  } as unknown as Payload

  return { payload, calls, creates, transactions }
}

const INPUT = {
  organizationName: 'Acme',
  industry: 'Healthcare',
  adminEmail: 'admin@acme.test',
  adminPassword: 'secret',
  adminName: 'Admin Acme',
}

test('orden de creación sigue doc 04: organization -> settings+subscription -> link -> office -> role -> user -> membership', async () => {
  const { payload, calls, creates, transactions } = makePayload()

  await createOrgWithAdmin(payload, INPUT)

  const subscription = creates.find((c) => c.collection === 'subscriptions')
  assert.equal(subscription?.data.level, 'basic')
  assert.equal(typeof subscription?.data.max_offices, 'number')
  assert.ok(subscription?.data.user_limits && typeof subscription.data.user_limits === 'object')

  assert.deepEqual(calls, [
    'beginTransaction',
    'create:organizations',
    'create:organization-settings',
    'create:subscriptions',
    'update:organizations',
    'create:offices',
    'find:roles',
    'create:users',
    'create:organization-memberships',
    'commitTransaction',
  ])
  assert.equal(transactions[0].committed, true)
  assert.equal(transactions[0].rolledBack, false)
})

test('falla a mitad de secuencia (role org_admin no sembrado) hace rollback de todo, nada queda commiteado', async () => {
  const { payload, calls, transactions } = makePayload({ roleDocs: [] })

  await assert.rejects(createOrgWithAdmin(payload, INPUT), /org_admin no sembrado/)

  assert.ok(calls.includes('create:offices'), 'la oficina ya se había creado antes del fallo')
  assert.ok(!calls.includes('create:users'), 'no debe llegar a crear el user tras el fallo')
  assert.equal(transactions[0].rolledBack, true)
  assert.equal(transactions[0].committed, false)
})

test('reusa la transacción de un externalReq en vez de abrir una propia', async () => {
  const { payload, calls, transactions } = makePayload()
  const externalReq = { transactionID: 'external-tx' } as PayloadRequest

  await createOrgWithAdmin(payload, INPUT, externalReq)

  assert.ok(!calls.includes('beginTransaction'), 'no debe abrir una transacción propia')
  assert.ok(!calls.includes('commitTransaction'), 'no debe commitear la transacción del caller')
  assert.equal(transactions.length, 0)
  assert.equal(externalReq.transactionID, 'external-tx')
})
