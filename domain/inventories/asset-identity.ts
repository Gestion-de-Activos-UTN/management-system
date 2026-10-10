import type { AssetPayload } from '@/contracts/asset.schema'

/** Classify address bits ourselves; scanner metadata is diagnostic evidence. */
export function classifyMac(mac: string): AssetPayload['mac_metadata']['kind'] {
  if (!mac) return 'unknown'
  if (!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac) || mac === '00:00:00:00:00:00') return 'invalid'
  if (mac.toUpperCase() === 'FF:FF:FF:FF:FF:FF') return 'broadcast'
  const first = Number.parseInt(mac.slice(0, 2), 16)
  if (first & 1) return 'multicast'
  return first & 2 ? 'locally_administered' : 'globally_administered'
}

export function normalizeAssetIdentity(asset: AssetPayload): AssetPayload {
  const mac = asset.mac.toUpperCase()
  const kind = classifyMac(mac)
  return { ...asset, mac: kind === 'globally_administered' || kind === 'locally_administered' ? mac : '', vendor: kind === 'globally_administered' ? asset.vendor : '', mac_metadata: { ...asset.mac_metadata, kind, vendor_resolution: kind === 'globally_administered' ? asset.mac_metadata.vendor_resolution : 'not_attempted' } }
}

export function assetIdentityKey(org: string, office: string, asset: Pick<AssetPayload, 'mac' | 'ip'>) {
  const kind = classifyMac(asset.mac)
  return kind === 'globally_administered'
    ? `${org}:mac:${asset.mac}`
    : kind === 'locally_administered'
      ? `${org}:office:${office}:mac:${asset.mac}`
      : `${org}:office:${office}:ip:${asset.ip}`
}
