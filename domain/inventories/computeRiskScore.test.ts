import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeRiskScore } from './computeRiskScore'

test('computeRiskScore: sin activos es 0', () => {
  assert.equal(computeRiskScore([]), 0)
})

test('computeRiskScore: todo activo y online es 0', () => {
  assert.equal(
    computeRiskScore([
      { criticality: 'high', status: 'active' },
      { criticality: 'low', status: 'active' },
    ]),
    0
  )
})

test('computeRiskScore: todo offline es 100', () => {
  assert.equal(
    computeRiskScore([
      { criticality: 'high', status: 'offline' },
      { criticality: 'low', status: 'offline' },
    ]),
    100
  )
})

test('computeRiskScore: un activo crítico offline pesa más que uno de baja criticidad', () => {
  const score = computeRiskScore([
    { criticality: 'critical', status: 'offline' },
    { criticality: 'low', status: 'active' },
  ])
  // peso offline = 5, peso total = 5 + 1 = 6 -> 83%
  assert.equal(score, 83)
})

test('computeRiskScore: retired no participa del cálculo', () => {
  assert.equal(
    computeRiskScore([
      { criticality: 'critical', status: 'retired' },
      { criticality: 'low', status: 'active' },
    ]),
    0
  )
})
