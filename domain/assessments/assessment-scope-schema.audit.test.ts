import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AssessmentScopeInputSchema,
  createAssessmentScopeInputSchema,
} from './assessment-scope-schema'
import { validateAssetAssessmentScope } from './validateAssetAssessmentScope'
import { AssetBusinessFieldsSchema } from '@/modules/assets/schema'
import { NonNetworkAssetSchema } from '@/modules/non-network-assets/schema'
import { MANUAL_ASSET_CATEGORY_VALUES } from '@/domain/assets/asset-types'

const original = {
  assessment_scope: 'excluded',
  assessment_exclusion_reason: 'temporary_or_lab',
  assessment_exclusion_note: null,
  assessment_excluded_until: '2026-10-20T12:00:00.000Z',
}
afterEach(() => vi.useRealTimers())

describe('VAL-01: validate effective exclusion and shared form rules', () => {
  it.each(['assessment_excluded_until', 'assessment_exclusion_reason'])(
    'rejects explicit null for %s',
    async field => {
      await expect(
        validateAssetAssessmentScope({
          originalDoc: original,
          data: { [field]: null },
          req: {},
        } as never)
      ).rejects.toMatchObject({ status: 400 })
    }
  )
  it('preserves omitted fields in an unrelated edit', async () => {
    const data = { alias: 'Changed alias' }
    expect(
      await validateAssetAssessmentScope({ originalDoc: original, data, req: {} } as never)
    ).toEqual(data)
  })
  it('rejects empty other reason and clears included metadata', async () => {
    await expect(
      validateAssetAssessmentScope({
        originalDoc: { ...original, assessment_exclusion_reason: 'other' },
        data: { assessment_exclusion_note: null },
        req: {},
      } as never)
    ).rejects.toMatchObject({ status: 400 })
    expect(
      await validateAssetAssessmentScope({
        originalDoc: original,
        data: { assessment_scope: 'included' },
        req: {},
      } as never)
    ).toMatchObject({ assessment_excluded_until: null })
  })
  it('requires a future date up to the exact 90-day boundary', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-10T12:00:00Z'))
    for (const date of [null, '2026-10-10T12:00:00Z', '2027-01-09T12:00:00Z'])
      expect(
        AssessmentScopeInputSchema.safeParse({ ...original, assessment_excluded_until: date })
          .success
      ).toBe(false)
    expect(
      AssessmentScopeInputSchema.safeParse({
        ...original,
        assessment_excluded_until: new Date(Date.now() + 90 * 86400000).toISOString(),
      }).success
    ).toBe(true)
  })
  it('both asset forms require expiration, and reject invalid values', () => {
    const scope = { ...original, assessment_excluded_until: null }
    const network = {
      ...scope,
      authorization_status: 'authorized',
      alias: null,
      criticality: 'medium',
      owner: null,
      location: null,
      status: 'active',
    }
    const manual = {
      ...scope,
      alias: 'Laptop',
      asset_category: MANUAL_ASSET_CATEGORY_VALUES[0],
      criticality: 'medium',
      owner: 'owner',
      location: null,
      status: 'active',
      office: 'office',
      review_interval: 'never',
    }
    const first = AssetBusinessFieldsSchema.safeParse(network)
    const second = NonNetworkAssetSchema.safeParse(manual)
    expect(first.success).toBe(false)
    expect(second.success).toBe(false)
    if (!first.success)
      expect(first.error.issues.some(i => i.path[0] === 'assessment_excluded_until')).toBe(true)
    if (!second.success)
      expect(second.error.issues.some(i => i.path[0] === 'assessment_excluded_until')).toBe(true)
  })
  it('an unchanged expired deadline does not block unrelated edits while reinclusion is pending', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'))
    expect(createAssessmentScopeInputSchema(original).safeParse(original).success).toBe(true)
    expect(
      createAssessmentScopeInputSchema(original).safeParse({
        ...original,
        assessment_excluded_until: null,
      }).success
    ).toBe(false)
    expect(
      createAssessmentScopeInputSchema(original).safeParse({
        ...original,
        assessment_excluded_until: '2026-10-19T12:00:00Z',
      }).success
    ).toBe(false)
  })
})
