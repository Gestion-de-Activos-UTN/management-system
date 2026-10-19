import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OfficeStatusSchema } from './schema'

const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`

test('OfficeStatusSchema: reactivar no pide nada más', () => {
  assert.deepEqual(OfficeStatusSchema.parse({ is_active: true }), { is_active: true })
})

test('OfficeStatusSchema: desactivar exige el nombre y acepta mover o dar de baja cada activo', () => {
  assert.equal(OfficeStatusSchema.safeParse({ is_active: false }).success, false)
  assert.equal(
    OfficeStatusSchema.safeParse({ is_active: false, confirm_name: '  ' }).success,
    false
  )
  const parsed = OfficeStatusSchema.parse({
    is_active: false,
    confirm_name: ' Sede Centro ',
    manual_asset_decisions: [
      { asset_id: uuid(1), destination: uuid(2) },
      { asset_id: uuid(3), destination: 'retire' },
    ],
  })
  assert.deepEqual(parsed, {
    is_active: false,
    confirm_name: 'Sede Centro',
    manual_asset_decisions: [
      { asset_id: uuid(1), destination: uuid(2) },
      { asset_id: uuid(3), destination: 'retire' },
    ],
  })
})

test('OfficeStatusSchema: sin activos manuales, los destinos son una lista vacía', () => {
  const parsed = OfficeStatusSchema.parse({ is_active: false, confirm_name: 'Sede' })
  assert.deepEqual(parsed, { is_active: false, confirm_name: 'Sede', manual_asset_decisions: [] })
})

test('OfficeStatusSchema: rechaza destinos que no son ids', () => {
  const result = OfficeStatusSchema.safeParse({
    is_active: false,
    confirm_name: 'Sede',
    manual_asset_decisions: [{ asset_id: 'x', destination: uuid(2) }],
  })
  assert.equal(result.success, false)
})

test('OfficeStatusSchema: confirma nombres guardados con símbolos, pero no caracteres de control', () => {
  const parsed = OfficeStatusSchema.parse({ is_active: false, confirm_name: 'I+D: Centro' })
  assert.equal(parsed.is_active === false && parsed.confirm_name, 'I+D: Centro')
  assert.equal(
    OfficeStatusSchema.safeParse({ is_active: false, confirm_name: 'Sede\u0000' }).success,
    false
  )
})

test('OfficeStatusSchema: el destino es una oficina o dar de baja, nada más', () => {
  const result = OfficeStatusSchema.safeParse({
    is_active: false,
    confirm_name: 'Sede',
    manual_asset_decisions: [{ asset_id: uuid(1), destination: 'keep' }],
  })
  assert.equal(result.success, false)
})
