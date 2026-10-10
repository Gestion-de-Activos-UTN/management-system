import { z } from 'zod'

const ipv4Number = (ip: string) => ip.split('.').reduce((n, octet) => n * 256 + Number(octet), 0)

export function parseInterfaceNetwork(cidr: string): { address: number; mask: number } | null {
  const [ip, prefix, extra] = cidr.split('/')
  if (
    extra !== undefined ||
    !z.ipv4().safeParse(ip).success ||
    !/^(\d|[12]\d|3[0-2])$/.test(prefix ?? '')
  )
    return null
  const address = ipv4Number(ip)
  const mask = Number(prefix) === 0 ? 0 : (0xffffffff << (32 - Number(prefix))) >>> 0
  if ((address & mask) >>> 0 !== address) return null
  // The agent's supported scope is private IPv4, at most a /16.
  const parts = ip.split('.').map(Number)
  const minimum =
    parts[0] === 10
      ? 8
      : parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31
        ? 12
        : parts[0] === 192 && parts[1] === 168
          ? 16
          : 33
  if (Number(prefix) < minimum) return null
  return { address, mask }
}

export function parseScanNetwork(cidr: string) {
  return Number(cidr.split('/')[1]) >= 16 ? parseInterfaceNetwork(cidr) : null
}

export const InterfaceNetworkSchema = z
  .string()
  .max(43)
  .refine(
    value => parseInterfaceNetwork(value) !== null,
    'Use a canonical private IPv4 interface network'
  )

export const ScanNetworkSchema = z
  .string()
  .max(43)
  .refine(
    value => parseScanNetwork(value) !== null,
    'Use a canonical private IPv4 network with prefix /16–/32'
  )

export function networkContains(cidr: string, ip: string): boolean {
  const network = parseScanNetwork(cidr)
  return Boolean(
    network &&
    z.ipv4().safeParse(ip).success &&
    (ipv4Number(ip) & network.mask) >>> 0 === network.address
  )
}
