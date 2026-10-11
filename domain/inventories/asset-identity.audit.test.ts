import { expect, it } from 'vitest'
import { assetIdentityKey, classifyMac, normalizeAssetIdentity } from './asset-identity'
import { auditAsset } from './remaining-audit-fixtures'
it('derives MAC class from address bits and ignores contradictory scanner metadata', () => {
  expect(classifyMac('02:11:22:33:44:55')).toBe('locally_administered')
  expect(classifyMac('01:11:22:33:44:55')).toBe('multicast')
  expect(classifyMac('FF:FF:FF:FF:FF:FF')).toBe('broadcast')
  expect(classifyMac('00:00:00:00:00:00')).toBe('invalid')
  const asset = auditAsset({ agentId: 'a', officeId: 'o', organizationId: 'g' }, { mac: '02:aa:bb:cc:dd:ee', vendor: 'untrusted', mac_metadata: { kind: 'globally_administered', vendor_resolution: 'resolved' } })
  const normalized = normalizeAssetIdentity(asset)
  expect(normalized.mac).toBe('02:AA:BB:CC:DD:EE')
  expect(normalized.mac_metadata.kind).toBe('locally_administered')
  expect(normalized.vendor).toBe('')
})
it('scopes global, local and provisional recognition without crossing organizations', () => {
  const global = { mac: '00:11:22:33:44:55', ip: '10.0.0.1' }
  expect(assetIdentityKey('g', 'o', global)).toBe(assetIdentityKey('g', 'other', global))
  expect(assetIdentityKey('g', 'o', global)).not.toBe(assetIdentityKey('other', 'o', global))
  const local = { ...global, mac: '02:11:22:33:44:55' }
  expect(assetIdentityKey('g', 'o', local)).not.toBe(assetIdentityKey('g', 'other', local))
  expect(assetIdentityKey('g', 'o', local)).toBe(assetIdentityKey('g', 'o', { ...local, ip: '10.0.0.2' }))
})
