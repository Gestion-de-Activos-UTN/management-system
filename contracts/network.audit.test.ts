import { expect, it } from 'vitest'
import { InterfaceNetworkSchema, ScanNetworkSchema, networkContains } from './network'

it('accepts legitimate interface subnets without expanding allowed scan scope', () => {
  expect(InterfaceNetworkSchema.safeParse('10.0.0.0/8').success).toBe(true)
  expect(InterfaceNetworkSchema.safeParse('172.16.0.0/12').success).toBe(true)
  expect(ScanNetworkSchema.safeParse('10.0.0.0/8').success).toBe(false)
  expect(InterfaceNetworkSchema.safeParse('172.0.0.0/8').success).toBe(false)
  expect(ScanNetworkSchema.safeParse('10.0.1.0/24').success).toBe(true)
  expect(networkContains('10.0.1.0/24', '10.0.2.1')).toBe(false)
})
