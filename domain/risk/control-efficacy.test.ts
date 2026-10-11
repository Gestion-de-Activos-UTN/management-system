import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { RISK_QUESTIONS_V2 } from './catalog-v2'
import { evaluateControlEfficacy } from './control-efficacy'

const close = (actual: number | null, expected: number) =>
  assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`)

const optionKeys = (questionKey: string) =>
  RISK_QUESTIONS_V2.find(question => question.key === questionKey)!
    .options.filter(option => option.efficacy !== null)
    .map(option => option.key)

describe('evaluateControlEfficacy', () => {
  it('A.8.5: no unlock forces idle lock to zero, even when idle lock is unknown', () => {
    for (const idle of ['under_3m', 'unknown']) {
      const result = evaluateControlEfficacy(
        'A.8.5',
        { 'A.8.5.unlock': 'none', 'A.8.5.idle_lock': idle },
        'essential'
      )
      assert.equal(result.status, 'evaluable')
      close(result.efficacy, 0)
      assert.deepEqual(result.applied_rules, ['A.8.5.no_unlock_forces_idle_zero'])
      assert.equal(result.sub[1].base, idle === 'unknown' ? null : 1)
    }
  })

  it('A.8.7: inactive protection forces updates to zero', () => {
    const result = evaluateControlEfficacy(
      'A.8.7',
      { 'A.8.7.protection_active': 'none', 'A.8.7.protection_updates': 'automatic_central' },
      'essential'
    )
    close(result.efficacy, 0)
    assert.deepEqual(result.applied_rules, ['A.8.7.no_protection_forces_updates_zero'])
  })

  it('A.8.9/A.8.20: default password halves firmware efficacy', () => {
    const result = evaluateControlEfficacy(
      'A.8.9/A.8.20',
      { 'A.8.9-20.default_password': 'default', 'A.8.9-20.firmware': 'automatic' },
      'essential'
    )
    close(result.sub[1].adjusted, 0.5)
    close(result.efficacy, 0.25)
  })

  it('A.8.9/A.8.20: multiply does not revive an unknown firmware answer', () => {
    const result = evaluateControlEfficacy(
      'A.8.9/A.8.20',
      { 'A.8.9-20.default_password': 'default', 'A.8.9-20.firmware': 'unknown' },
      'essential'
    )
    assert.equal(result.status, 'not_evaluable')
    assert.deepEqual(result.applied_rules, [])
  })

  it('A.7.9: one dimension at zero never exceeds the documented 0.5 cap', () => {
    for (const other of optionKeys('A.7.9.remote_actions')) {
      const result = evaluateControlEfficacy(
        'A.7.9',
        { 'A.7.9.physical_protection': 'none', 'A.7.9.remote_actions': other },
        'essential'
      )
      assert.ok(result.efficacy! <= 0.5)
    }
    for (const other of optionKeys('A.7.9.physical_protection')) {
      const result = evaluateControlEfficacy(
        'A.7.9',
        { 'A.7.9.physical_protection': other, 'A.7.9.remote_actions': 'none' },
        'essential'
      )
      assert.ok(result.efficacy! <= 0.5)
    }
  })

  it('averages sub-questions without intermediate rounding', () => {
    const result = evaluateControlEfficacy(
      'A.8.5',
      { 'A.8.5.unlock': 'strong_password', 'A.8.5.idle_lock': 'between_3m_10m' },
      'essential'
    )
    close(result.efficacy, 0.7)
    assert.deepEqual(result.applied_rules, [])
  })

  it('reinforced-only questions count only under the reinforced policy', () => {
    const answers = { 'A.5.15.individual_accounts': 'yes', 'A.5.15.access_revocation': 'yes' }
    const essential = evaluateControlEfficacy('A.5.15', answers, 'essential')
    close(essential.efficacy, 1)
    assert.equal(essential.sub.length, 2)
    assert.equal(evaluateControlEfficacy('A.5.15', answers, 'reinforced').status, 'not_evaluable')
  })

  it('unknown or missing is not evaluable, never zero', () => {
    const unknown = evaluateControlEfficacy('A.8.13', { 'A.8.13.backup': 'unknown' }, 'essential')
    assert.equal(unknown.status, 'not_evaluable')
    assert.equal(unknown.efficacy, null)
    assert.equal(evaluateControlEfficacy('A.8.13', {}, 'essential').status, 'not_evaluable')
  })

  it('drops justified not_applicable sub-questions; all of them makes the pair not applicable', () => {
    const partial = evaluateControlEfficacy(
      'A.7.9',
      { 'A.7.9.physical_protection': 'locked_only', 'A.7.9.remote_actions': 'not_applicable' },
      'essential'
    )
    close(partial.efficacy, 0.6)
    const all = evaluateControlEfficacy(
      'A.8.13',
      { 'A.8.13.backup': 'not_applicable' },
      'essential'
    )
    assert.equal(all.status, 'not_applicable')
  })

  it('rejects answers outside the catalog and automatic controls', () => {
    assert.throws(
      () => evaluateControlEfficacy('A.8.13', { 'A.8.13.backup': 'bogus' }, 'essential'),
      /not an option/
    )
    assert.throws(() => evaluateControlEfficacy('A.8.21', {}, 'essential'), /not evaluated/)
  })
})
