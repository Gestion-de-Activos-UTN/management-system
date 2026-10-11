import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { RISK_CATALOG_V2, RISK_CONDITIONAL_RULES_V2, RISK_QUESTIONS_V2 } from '.'
import type { RiskCatalogV2 } from './types'
import { validateRiskCatalogV2 } from './validate-catalog'

const clone = () => structuredClone(RISK_CATALOG_V2) as unknown as RiskCatalogV2

describe('risk catalog v2', () => {
  it('validates the complete catalog', () => {
    assert.doesNotThrow(() => validateRiskCatalogV2(RISK_CATALOG_V2))
    assert.equal(RISK_CATALOG_V2.controls.length, 17)
    assert.equal(RISK_QUESTIONS_V2.length, 19)
  })

  it('keeps every efficacy inside 0..1 and unknown options non evaluable', () => {
    for (const question of RISK_QUESTIONS_V2) {
      assert.equal(question.options.find(option => option.key === 'unknown')?.efficacy, null)
      assert.equal(question.options.find(option => option.key === 'not_applicable')?.efficacy, null)
      for (const option of question.options) {
        if (option.efficacy !== null) assert.ok(option.efficacy >= 0 && option.efficacy <= 1)
      }
    }
  })

  it('contains the documented conditional rules (A.7.9 cap is implied by averaging)', () => {
    assert.deepEqual(
      RISK_CONDITIONAL_RULES_V2.map(rule => rule.operation),
      ['force_zero', 'force_zero', 'multiply']
    )
  })

  it('rejects a conditional rule that triggers on a missing option', () => {
    const typo = clone()
    ;(typo.conditional_rules[0] as { when_option_key: string }).when_option_key = 'nonee'
    assert.throws(() => validateRiskCatalogV2(typo), /missing option nonee/)
  })

  it('rejects duplicate keys, dangling references and invalid efficacies', () => {
    const duplicate = clone()
    duplicate.questions[1].key = duplicate.questions[0].key
    assert.throws(() => validateRiskCatalogV2(duplicate), /duplicate question key/)

    const dangling = clone()
    dangling.questions[0].control_key = 'missing'
    assert.throws(() => validateRiskCatalogV2(dangling), /missing control/)

    const invalidEfficacy = clone()
    invalidEfficacy.questions[0].options[0].efficacy = 1.1
    assert.throws(() => validateRiskCatalogV2(invalidEfficacy), /outside 0\.\.1/)
  })
})
