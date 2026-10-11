import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { maturityLevel } from './maturity'

describe('maturityLevel', () => {
  it('follows the table of the maturity dictionary', () => {
    assert.equal(maturityLevel('no', 'none'), 'initial')
    assert.equal(maturityLevel('yes', 'none'), 'managed') // dictionary example
    assert.equal(maturityLevel('no', 'occasional'), 'managed')
    assert.equal(maturityLevel('yes', 'occasional'), 'managed')
    assert.equal(maturityLevel('yes', 'recurring'), 'advanced')
  })

  it('never reaches advanced with budget but nobody in charge', () => {
    assert.equal(maturityLevel('no', 'recurring'), 'managed')
  })

  it('returns no level while an answer is missing, so it is never assumed', () => {
    assert.equal(maturityLevel(null, 'recurring'), null)
    assert.equal(maturityLevel('yes', undefined), null)
  })
})
