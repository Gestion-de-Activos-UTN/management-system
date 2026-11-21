import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { complianceStatusFor } from './compliance-status'

describe('complianceStatusFor', () => {
  it('maps efficacy to the five persisted states', () => {
    assert.equal(complianceStatusFor(1), 'compliant')
    assert.equal(complianceStatusFor(0), 'non_compliant')
    assert.equal(complianceStatusFor(0.4), 'partially_effective')
    assert.equal(complianceStatusFor(0.999), 'partially_effective')
    assert.equal(complianceStatusFor(null), 'not_evaluable')
  })

  it('keeps a justified not-applicable apart from missing information', () => {
    assert.equal(complianceStatusFor(null, true), 'not_applicable')
    assert.equal(complianceStatusFor(null, false), 'not_evaluable')
  })
})
