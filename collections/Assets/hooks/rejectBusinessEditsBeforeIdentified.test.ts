import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rejectBusinessEditsBeforeIdentified } from './rejectBusinessEditsBeforeIdentified'

function run(data: Record<string, unknown>, originalDoc: Record<string, unknown>) {
  return (rejectBusinessEditsBeforeIdentified as unknown as (args: {
    data: Record<string, unknown>
    originalDoc: Record<string, unknown>
    // req/operation/context no los usa este hook — solo lo que necesita el test.
  }) => unknown)({ data, originalDoc })
}

test('bloquea alias si el activo no está identificado', () => {
  assert.throws(
    () => run({ alias: 'nuevo alias' }, { alias: 'viejo', identified: false }),
    e => (e as { status?: number }).status === 400
  )
})

test('bloquea location/criticality/owner del mismo modo', () => {
  for (const field of ['location', 'criticality', 'owner']) {
    assert.throws(
      () => run({ [field]: 'x' }, { [field]: 'y', identified: false }),
      e => (e as { status?: number }).status === 400
    )
  }
})

test('permite editar los 4 campos si ya está identificado', () => {
  assert.doesNotThrow(() => run({ alias: 'nuevo alias' }, { alias: 'viejo', identified: true }))
})

test('permite identificar y editar en la misma request', () => {
  assert.doesNotThrow(() => run({ identified: true, alias: 'nuevo alias' }, { alias: 'viejo', identified: false }))
})

test('permite tocar status/identified siempre, aunque no esté identificado', () => {
  assert.doesNotThrow(() => run({ status: 'retired' }, { status: 'active', identified: false }))
  assert.doesNotThrow(() => run({ identified: true }, { identified: false }))
})

test('no bloquea si el campo viene pero con el mismo valor (no es una edición real)', () => {
  assert.doesNotThrow(() => run({ alias: 'igual' }, { alias: 'igual', identified: false }))
})
