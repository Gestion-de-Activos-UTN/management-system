import { expect, it } from 'vitest'
import { expireSnapshotTechnicalEvidence, observationExpired } from './technical-evidence'

it('expires at the boundary and handles unknown observation dates conservatively', () => {
  const cutoff = Date.parse('2026-01-01T00:00:00Z')
  expect(observationExpired('2026-01-01T00:00:00Z', cutoff)).toBe(true)
  expect(observationExpired('2026-01-01T00:00:01Z', cutoff)).toBe(false)
  expect(observationExpired(null, cutoff)).toBe(true)
})
it('a new snapshot does not renew old raw evidence, and cleanup is repeatable', () => {
  const dump = {
    network: [
      {
        id: 'old',
        last_seen: '2025-12-01T00:00:00Z',
        hostname: 'old-host',
        services: [{ port: 22, scripts: { raw: 'old' } }],
        host_scripts: { raw: 'old' },
      },
      { id: 'new', last_seen: '2026-01-02T00:00:00Z', host_scripts: { raw: 'current' } },
    ],
    non_network: [{ name: 'License' }],
  }
  const cutoff = Date.parse('2026-01-01T00:00:00Z')
  const clean = expireSnapshotTechnicalEvidence(dump, cutoff)
  expect(clean.network[0]).toEqual({
    id: 'old',
    last_seen: '2025-12-01T00:00:00Z',
    hostname: 'old-host',
    services: [{ port: 22 }],
  })
  expect(clean.network[1]).toEqual(dump.network[1])
  expect(clean.non_network).toEqual(dump.non_network)
  expect(expireSnapshotTechnicalEvidence(clean, cutoff)).toEqual(clean)
  expect(dump.network[0].host_scripts).toBeDefined()
})
