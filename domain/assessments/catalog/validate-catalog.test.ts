import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ASSESSMENT_CATALOG } from '.'
import type { AssessmentCatalog } from './catalog-types'
import { validateAssessmentCatalog } from './validate-catalog'

const cloneCatalog = () => structuredClone(ASSESSMENT_CATALOG) as unknown as AssessmentCatalog

describe('assessment catalog', () => {
  it('accepts the frozen version 1 catalog', () => {
    assert.doesNotThrow(() => validateAssessmentCatalog(ASSESSMENT_CATALOG))
  })

  it('rejects missing references and incompatible scopes', () => {
    const missingControl = cloneCatalog()
    missingControl.questions[0].control_keys = ['A.0.0']
    assert.throws(() => validateAssessmentCatalog(missingControl), /missing control/)

    const incompatibleScope = cloneCatalog()
    incompatibleScope.questions[0].scope = 'office'
    assert.throws(() => validateAssessmentCatalog(incompatibleScope), /incompatible/)
  })

  it('rejects invalid asset types and dangling dependencies', () => {
    const invalidType = cloneCatalog()
    invalidType.questions.find(question => question.scope === 'asset')!.applies_to_asset_types = [
      'spaceship' as never,
    ]
    assert.throws(() => validateAssessmentCatalog(invalidType), /invalid asset type/)

    const missingDependency = cloneCatalog()
    missingDependency.questions[0].dependencies = [
      { type: 'requires_question_answer', question_key: 'missing', answers: ['yes'] },
    ]
    assert.throws(() => validateAssessmentCatalog(missingDependency), /depends on missing question/)
  })

  it('requires unknown and not applicable to remain not evaluable', () => {
    const unsafe = cloneCatalog()
    unsafe.questions[0].evaluation.unknown.status = 'non_compliant'
    assert.throws(() => validateAssessmentCatalog(unsafe), /out of risk/)
  })

  it('rejects non-positive versioned risk weights', () => {
    const unsafe = cloneCatalog()
    unsafe.policies[0].risk_weights.severity.critical = 0
    assert.throws(() => validateAssessmentCatalog(unsafe), /positive risk weights/)
  })
})
