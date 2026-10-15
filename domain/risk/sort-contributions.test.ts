import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sortContributions } from './sort-contributions'

const labels: Record<string, string> = { 'asset:1': 'Zeta', 'asset:2': 'alfa', 'manual:3': 'Beta' }
const label = (key: string) => labels[key] ?? key
const row = (
  id: string,
  asset_key: string,
  control_key: string,
  status: 'compliant' | 'partially_effective' | 'non_compliant' | 'not_evaluable' = 'compliant',
  excluded = false
) => ({ id, asset_key, control_key, status, excluded })

const rows = [
  row('a', 'asset:1', 'A.8.2', 'non_compliant'),
  row('b', 'asset:2', 'A.8.1', 'compliant'),
  row('c', 'manual:3', 'A.8.1', 'not_evaluable'),
  row('d', 'asset:1', 'A.8.1', 'partially_effective'),
  row('e', 'asset:2', 'A.8.2', 'non_compliant', true),
]
const ids = (sorted: Array<{ id: string }>) => sorted.map(item => item.id).join('')

test('por activo usa el nombre visible, sin distinguir mayúsculas, y desempata por control', () => {
  assert.equal(ids(sortContributions(rows, label, 'asset', 'asc')), 'becda')
  assert.equal(ids(sortContributions(rows, label, 'asset', 'desc')), 'dacbe')
})

test('por resultado: cumple → parcial → requiere atención → sin información → excluido', () => {
  assert.equal(ids(sortContributions(rows, label, 'status', 'asc')), 'bdace')
})

test('por control desempata por activo', () => {
  assert.equal(ids(sortContributions(rows, label, 'control', 'asc')), 'bcdea')
})

test('filas idénticas en todo quedan en orden de id (paginación estable)', () => {
  const twins = [row('2', 'asset:1', 'A.8.1'), row('1', 'asset:1', 'A.8.1')]
  assert.equal(ids(sortContributions(twins, label, 'asset', 'desc')), '12')
})
