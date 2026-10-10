import { expect, it } from 'vitest'
import { canDo } from './permissions'
import { redactTechnicalEvidence } from './technical-evidence'

it('grants technical read to administrative roles, not viewers', () => {
  for (const role of ['org_admin', 'office_manager', 'platform_admin'] as const)
    expect(canDo(role, 'scan-reports', 'read_technical', 'org')).toBe(true)
  expect(canDo('org_viewer', 'scan-reports', 'read_technical', 'org')).toBe(false)
})
it('redacts nested script outputs without changing normalized inventory or source value', () => {
  const source = {
    network: [
      {
        host_scripts: { secret: 'value' },
        services: [{ port: 22, scripts: { secret: 'value' } }],
        hostname: 'device',
      },
    ],
    non_network: [{ name: 'Document' }],
  }
  expect(redactTechnicalEvidence(source)).toEqual({
    network: [{ services: [{ port: 22 }], hostname: 'device' }],
    non_network: [{ name: 'Document' }],
  })
  expect(source.network[0].host_scripts).toBeDefined()
})
