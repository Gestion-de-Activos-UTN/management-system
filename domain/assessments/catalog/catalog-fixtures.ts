import type { ScannedAssetType } from '@/domain/assets/asset-types'

export const ASSESSMENT_CATALOG_FIXTURES = {
  organization: { id: 'org-fixture', is_active: true },
  office: { id: 'office-fixture', organization_id: 'org-fixture', is_active: true },
  workstation: {
    id: 'asset-workstation',
    organization_id: 'org-fixture',
    office_id: 'office-fixture',
    confirmed_type: 'workstation' as ScannedAssetType,
    status: 'active',
  },
  gateway: {
    id: 'asset-gateway',
    organization_id: 'org-fixture',
    office_id: 'office-fixture',
    confirmed_type: 'gateway' as ScannedAssetType,
    status: 'active',
  },
  prohibited_service: {
    port: 23,
    protocol: 'tcp',
    state: 'open',
    name: 'telnet',
    confidence: 10,
    detection_method: 'probed',
    tunnel: '',
  },
  ambiguous_service: {
    port: 3389,
    protocol: 'tcp',
    state: 'open',
    name: 'ms-wbt-server',
    confidence: 7,
    detection_method: 'probed',
    tunnel: '',
  },
  insufficient_coverage: {
    port_scan: 'partial',
    service_detection: 'unknown',
    os_detection: 'unknown',
    name_resolution: 'partial',
  },
} as const
