import { expect, it } from 'vitest'
import { officeRiskScope } from './office-risk-scope'

const manager = { orgWide: false, officeIds: ['palermo', 'cordoba'] }

it('keeps all assigned offices selected for a Manager instead of substituting the first office', () => {
  expect(officeRiskScope(manager, null)).toEqual({
    officeId: null,
    requiresOfficeSelection: true,
    ready: false,
  })
})
it('allows an organization-wide evaluation for OrgAdmin', () => {
  expect(officeRiskScope({ ...manager, orgWide: true }, null)).toEqual({
    officeId: null,
    requiresOfficeSelection: false,
    ready: true,
  })
})
it('uses the selected office for a scoped evaluation', () => {
  expect(officeRiskScope(manager, 'palermo')).toEqual({
    officeId: 'palermo',
    requiresOfficeSelection: false,
    ready: true,
  })
})
it('automatically resolves the only available office', () => {
  expect(officeRiskScope({ orgWide: false, officeIds: ['cordoba'] }, null)).toEqual({
    officeId: 'cordoba',
    requiresOfficeSelection: false,
    ready: true,
  })
})
it('does not request another tenant office while the selector is normalizing it', () => {
  expect(officeRiskScope(manager, 'foreign-office').ready).toBe(false)
  expect(officeRiskScope(manager, 'foreign-office').officeId).toBeNull()
})
it('waits until tenant scope is known', () => {
  expect(officeRiskScope(undefined, null).ready).toBe(false)
})

it('enables the assigned-office consolidation only with the effective server permission', () => {
  expect(officeRiskScope({ ...manager, permissions: { assignedOfficeRisk: true } }, null)).toEqual({
    officeId: null,
    requiresOfficeSelection: false,
    ready: true,
  })
  expect(
    officeRiskScope({ ...manager, permissions: { assignedOfficeRisk: false } }, null).ready
  ).toBe(false)
})
