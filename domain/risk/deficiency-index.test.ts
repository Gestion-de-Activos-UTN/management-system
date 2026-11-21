import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateDeficiencyIndex, CONTROL_IMPORTANCE, type IndexPair } from './deficiency-index'

const pair = (
  control_key: string,
  compliance: number | null,
  criticality: IndexPair['criticality'] = 'medium'
): IndexPair => ({ control_key, compliance, criticality })

describe('calculateDeficiencyIndex (B pura)', () => {
  it('extremes: all compliant 0, all failing 100, nothing evaluable null (plan §8.1)', () => {
    assert.equal(calculateDeficiencyIndex([pair('A.8.7', 1), pair('A.8.2', 1)]).index, 0)
    assert.equal(calculateDeficiencyIndex([pair('A.8.7', 0), pair('A.8.2', 0)]).index, 100)
    const pending = calculateDeficiencyIndex([pair('A.8.7', null)])
    assert.equal(pending.index, null)
    assert.equal(pending.coverage, 0)
    assert.equal(pending.visibility, 'hidden')
    const empty = calculateDeficiencyIndex([])
    assert.equal(empty.coverage, null)
    assert.equal(empty.visibility, 'undetermined')
  })

  it('excludes inventory/visibility controls from index and coverage (D22)', () => {
    const result = calculateDeficiencyIndex([
      pair('A.8.7', 1),
      pair('A.5.9', 0),
      pair('A.5.12', null),
      pair('A.8.16', 0),
    ])
    assert.equal(result.index, 0)
    assert.equal(result.coverage, 100)
  })

  it('improving compliance never raises the index (§8.2)', () => {
    const base = [pair('A.8.2', 0.4, 'critical'), pair('A.8.7', 0.5), pair('A.8.13', null)]
    const better = [pair('A.8.2', 1, 'critical'), pair('A.8.7', 0.5), pair('A.8.13', null)]
    assert.ok(calculateDeficiencyIndex(better).index! < calculateDeficiencyIndex(base).index!)
  })

  it('replicating a uniform declaration on N assets keeps D_c (§8.3)', () => {
    const one = calculateDeficiencyIndex([pair('A.8.7', 0), pair('A.8.13', 1)])
    const many = calculateDeficiencyIndex([
      ...Array.from({ length: 10 }, () => pair('A.8.7', 0)),
      pair('A.8.13', 1),
    ])
    assert.equal(many.index, one.index)
  })

  it('criticality weighs inside the control only', () => {
    const result = calculateDeficiencyIndex([pair('A.8.7', 0, 'critical'), pair('A.8.7', 1, 'low')])
    assert.equal(result.controls[0].deficiency, 8 / 9)
    assert.equal(result.index, (100 * 8) / 9)
  })

  it('reference fixture: three critical servers multiple_as_needed (0.4), rest compliant → 11.71 (§8.17)', () => {
    const others = ['A.5.15', 'A.8.7', 'A.8.8', 'A.8.9/A.8.20', 'A.8.13', 'A.8.20', 'A.8.22', 'A.8.15', 'A.8.19', 'A.5.25']
    const pairs = [
      ...Array.from({ length: 3 }, () => pair('A.8.2', 0.4, 'critical')),
      ...others.map(key => pair(key, 1)),
    ]
    assert.equal(
      [...new Set(pairs.map(item => item.control_key))].reduce((s, k) => s + CONTROL_IMPORTANCE[k], 0),
      41
    )
    assert.equal(calculateDeficiencyIndex(pairs).index!.toFixed(2), '11.71')
  })

  it('coverage is linked outside: low-coverage control keeps full importance, warns at imp>=4 & cob<80 (D21)', () => {
    const result = calculateDeficiencyIndex([
      pair('A.8.7', 0),
      ...Array.from({ length: 9 }, () => pair('A.8.7', null)),
      pair('A.5.25', 1),
    ])
    assert.equal(result.index, (100 * 4) / 5)
    const malware = result.controls.find(control => control.control_key === 'A.8.7')!
    assert.equal(malware.warning, true)
    assert.equal(malware.pending_pairs, 9)
    assert.equal(result.controls.find(control => control.control_key === 'A.5.25')!.warning, false)
  })

  it('visibility 40/80 and bands 25/50/75', () => {
    const banded = calculateDeficiencyIndex([pair('A.8.7', 0.5), pair('A.8.2', 1)])
    assert.equal(banded.visibility, 'banded')
    assert.equal(banded.band, 'low')
    // (4·1 + 2·0 + 1·1) / 7 = 71 %
    const preliminary = calculateDeficiencyIndex([pair('A.8.7', 0), pair('A.8.15', null), pair('A.5.25', 0)])
    assert.equal(preliminary.visibility, 'preliminary')
    // (4·1 + 8·0 + 1·1) / 13 = 38 %
    assert.equal(
      calculateDeficiencyIndex([pair('A.8.7', 0), pair('A.8.2', null), pair('A.5.25', 0)]).visibility,
      'hidden'
    )
    assert.equal(preliminary.band, null)
  })

  it('ignores a justified not-applicable pair in index and coverage (Plan §3, §8.7)', () => {
    const base = [pair('A.8.7', 0.5), pair('A.8.13', null)]
    const withNotApplicable = [
      ...base,
      { ...pair('A.8.7', null, 'critical'), applicability: 'not_applicable' as const },
      { ...pair('A.8.2', null), applicability: 'not_applicable' as const },
    ]
    const expected = calculateDeficiencyIndex(base)
    const actual = calculateDeficiencyIndex(withNotApplicable)
    assert.equal(actual.index, expected.index)
    assert.equal(actual.coverage, expected.coverage)
    assert.equal(actual.controls.some(control => control.control_key === 'A.8.2'), false)
  })

  it('rejects a control without importance', () => {
    assert.throws(() => calculateDeficiencyIndex([pair('A.9.9', 1)]), /sin importancia/)
  })
})
