import { test } from 'node:test'
import assert from 'node:assert/strict'
import { InventorySnapshots } from './index'

// No requiere DB: son closures constantes (() => false), la regresión que importa evitar es que
// alguien las cambie "para probar algo rápido" y lo deje así — este test lo rompe de inmediato.
test('InventorySnapshots: update y delete son siempre false (inmutable)', async () => {
  const update = InventorySnapshots.access!.update as () => boolean | Promise<boolean>
  const del = InventorySnapshots.access!.delete as () => boolean | Promise<boolean>
  assert.equal(await update(), false)
  assert.equal(await del(), false)
})

test('InventorySnapshots: create a nivel de colección es siempre false (solo domain function)', async () => {
  const create = InventorySnapshots.access!.create as () => boolean | Promise<boolean>
  assert.equal(await create(), false)
})
