import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { POLICY_CATALOG, QUESTION_CATALOG } from './catalog'
import {
  hasSufficientTechnicalCoverage,
  resolveApplicableQuestions,
} from './resolveApplicableQuestions'

const essential = POLICY_CATALOG.find(policy => policy.key === 'essential')!
const reinforced = POLICY_CATALOG.find(policy => policy.key === 'reinforced')!

describe('assessment question applicability', () => {
  it('uses only a human-confirmed asset type', () => {
    const pending = resolveApplicableQuestions(
      {
        scope: 'asset',
        status: 'active',
        identified: false,
        identification_status: 'pending',
        confirmed_type: null,
      },
      essential,
      {},
      QUESTION_CATALOG
    )
    const workstation = resolveApplicableQuestions(
      {
        scope: 'asset',
        status: 'active',
        identified: true,
        identification_status: 'confirmed',
        confirmed_type: 'workstation',
      },
      essential,
      {},
      QUESTION_CATALOG
    )
    assert.equal(pending.length, 0)
    assert.equal(workstation.length, 7)
    assert.ok(
      workstation.every(question => question.applies_to_asset_types?.includes('workstation'))
    )
  })

  it('does not give endpoint questions to gateways or retired assets', () => {
    for (const subject of [
      {
        scope: 'asset' as const,
        status: 'active' as const,
        identified: true,
        identification_status: 'confirmed' as const,
        confirmed_type: 'gateway' as const,
      },
      {
        scope: 'asset' as const,
        status: 'retired' as const,
        identified: true,
        identification_status: 'confirmed' as const,
        confirmed_type: 'workstation' as const,
      },
    ]) {
      assert.deepEqual(resolveApplicableQuestions(subject, essential, {}, QUESTION_CATALOG), [])
    }
  })

  it('resolves policy and answer dependencies without executable expressions', () => {
    const organization = { scope: 'organization' as const, is_active: true }
    const withoutBackup = resolveApplicableQuestions(
      organization,
      reinforced,
      { answers: { 'backup.managed_recovery': 'no' } },
      QUESTION_CATALOG
    )
    const withBackup = resolveApplicableQuestions(
      organization,
      reinforced,
      { answers: { 'backup.managed_recovery': 'yes' } },
      QUESTION_CATALOG
    )
    assert.equal(
      withoutBackup.some(question => question.key === 'backup.restore_tested'),
      false
    )
    assert.equal(
      withBackup.some(question => question.key === 'backup.restore_tested'),
      true
    )
    assert.equal(
      resolveApplicableQuestions(organization, essential, {}, QUESTION_CATALOG).some(
        question => question.key === 'access.periodic_review'
      ),
      false
    )
  })

  it('never derives manual questions from scanner services or coverage', () => {
    const subject = {
      scope: 'asset' as const,
      status: 'active' as const,
      identified: true,
      identification_status: 'confirmed' as const,
      confirmed_type: 'gateway' as const,
    }
    assert.deepEqual(
      resolveApplicableQuestions(
        subject,
        essential,
        { services: [{ port: 23 }] } as never,
        QUESTION_CATALOG
      ),
      []
    )
  })

  it('accepts automatic evidence only with complete technical coverage', () => {
    assert.equal(
      hasSufficientTechnicalCoverage({
        technical_coverage: { port_scan: 'complete', service_detection: 'complete' },
      }),
      true
    )
    assert.equal(
      hasSufficientTechnicalCoverage({
        technical_coverage: { port_scan: 'partial', service_detection: 'complete' },
      }),
      false
    )
    assert.equal(hasSufficientTechnicalCoverage({}), false)
  })
})
