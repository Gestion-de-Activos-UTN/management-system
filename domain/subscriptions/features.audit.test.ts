import { expect, it } from 'vitest'
import { normalizeFeatures } from './features'

it('treats a key missing from an older subscription as included in the plan', () => {
  expect(normalizeFeatures({ asset_inventory: true, security_assessments: true })).toEqual({
    asset_inventory: true,
    security_assessments: true,
    risk_score: true,
    tasks: true,
  })
})

it('keeps an explicit false and ignores malformed values', () => {
  expect(normalizeFeatures({ risk_score: false }).risk_score).toBe(false)
  for (const raw of [null, undefined, [], 'risk_score'])
    expect(Object.values(normalizeFeatures(raw)).every(Boolean)).toBe(true)
})
