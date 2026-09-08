import type { NetworkBaselineRule } from './catalog-types'

export const NETWORK_BASELINE_VERSION = 1

export const NETWORK_BASELINE = [
  {
    key: 'network.gateway.dns.expected',
    version: 1,
    control_key: 'A.8.21',
    protocols: ['tcp', 'udp'],
    ports: [53],
    classification: 'expected',
    severity: 'low',
    minimum_confidence: 7,
    requires_complete_port_coverage: true,
    applies_to_asset_types: ['gateway'],
    message:
      'This gateway provides the name lookup function normally used by devices in the office.',
    recommendation: 'No action is needed while this remains an expected function of the gateway.',
  },
  {
    key: 'network.telnet.confirmed',
    version: 1,
    control_key: 'A.8.21',
    protocols: ['tcp'],
    ports: [23],
    classification: 'prohibited',
    severity: 'high',
    minimum_confidence: 8,
    requires_complete_port_coverage: true,
    message:
      'This device allows connections through an old method that does not properly protect transmitted information.',
    recommendation:
      'Ask whoever maintains the device to disable it or replace it with a protected connection method.',
  },
  {
    key: 'network.remote_access.review',
    version: 1,
    control_key: 'A.8.21',
    protocols: ['tcp'],
    ports: [3389],
    classification: 'review',
    severity: 'medium',
    minimum_confidence: 7,
    requires_complete_port_coverage: true,
    message:
      'SIAM found a remote access function but cannot verify that access is properly restricted.',
    recommendation: 'Ask whoever maintains this device to check who can use remote access.',
  },
  {
    key: 'network.file_sharing.review',
    version: 1,
    control_key: 'A.8.21',
    protocols: ['tcp'],
    ports: [139, 445],
    classification: 'review',
    severity: 'medium',
    minimum_confidence: 7,
    requires_complete_port_coverage: true,
    message:
      'SIAM found a file-sharing function but cannot verify that it is restricted correctly.',
    recommendation: 'Ask whoever maintains this device to check who can reach its shared files.',
  },
] as const satisfies readonly NetworkBaselineRule[]
