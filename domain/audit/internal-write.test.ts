import { test } from 'node:test'
import assert from 'node:assert/strict'
import { APIError, type RequestContext } from 'payload'
import { appendOnlyGuard } from './collection-guard'
import {
  consumeInternalAuditWrite,
  internalAuditWriteContext,
  pendingInternalAuditWrites,
  revokeInternalAuditWrite,
} from './internal-write'

type GuardArgs = Parameters<ReturnType<typeof appendOnlyGuard>>[0]
const guard = appendOnlyGuard('AuditLogs')
const run = (operation: string, context: RequestContext = {}) =>
  guard({ operation, context } as unknown as GuardArgs)

test('la marca sirve una sola vez y sale del contexto al usarla', () => {
  const before = pendingInternalAuditWrites()
  const context = internalAuditWriteContext()
  assert.equal(pendingInternalAuditWrites(), before + 1)
  assert.equal(consumeInternalAuditWrite(context), true)
  assert.equal(Object.getOwnPropertySymbols(context).length, 0, 'la marca sigue en el contexto')
  assert.equal(consumeInternalAuditWrite(context), false)
  assert.equal(pendingInternalAuditWrites(), before)
})

test('copiar la marca a otro contexto no la duplica: el token es uno solo', () => {
  const context = internalAuditWriteContext()
  const copy = { ...context } // como el spread de getRequestContext en Payload
  assert.equal(consumeInternalAuditWrite(copy), true)
  assert.equal(consumeInternalAuditWrite(context), false)
})

test('revocar invalida una marca que no se llegó a usar', () => {
  const before = pendingInternalAuditWrites()
  const context = internalAuditWriteContext()
  revokeInternalAuditWrite(context)
  assert.equal(pendingInternalAuditWrites(), before)
  assert.equal(consumeInternalAuditWrite(context), false)
})

test('nada que pueda venir de un cliente pasa por la marca', () => {
  const context = internalAuditWriteContext()
  try {
    // JSON no transporta Symbols: un contexto serializado llega vacío.
    assert.deepEqual(JSON.parse(JSON.stringify(context)), {})
    const forged = [
      {},
      { audit: true },
      { 'siam.audit.internal-write': true },
      { [Symbol('siam.audit.internal-write')]: Symbol('siam.audit.write-token') },
    ] as RequestContext[]
    for (const candidate of forged) assert.equal(consumeInternalAuditWrite(candidate), false)
    assert.equal(consumeInternalAuditWrite(undefined), false)
  } finally {
    revokeInternalAuditWrite(context)
  }
})

test('guard: create solo con la marca; update, delete y restoreVersion nunca', () => {
  const forbidden = (fn: () => unknown, pattern: RegExp) =>
    assert.throws(
      fn,
      error => error instanceof APIError && error.status === 403 && pattern.test(error.message)
    )

  assert.doesNotThrow(() => run('create', internalAuditWriteContext()))
  forbidden(() => run('create'), /solo se escribe desde el cierre transaccional/)
  forbidden(() => run('create', { audit: true }), /solo se escribe/)

  for (const operation of ['update', 'delete', 'restoreVersion']) {
    const context = internalAuditWriteContext() // ni con la marca
    try {
      forbidden(() => run(operation, context), /solo agregado/)
    } finally {
      revokeInternalAuditWrite(context)
    }
  }
  assert.doesNotThrow(() => run('read'))
  assert.doesNotThrow(() => run('count'))
})
