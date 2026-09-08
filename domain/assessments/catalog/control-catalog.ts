import type { ControlDefinition } from './catalog-types'

export const CONTROL_CATALOG = [
  {
    key: 'A.5.9',
    version: 1,
    title: 'Inventory of information and other associated assets',
    scopes: ['asset'],
  },
  { key: 'A.5.12', version: 1, title: 'Classification of information', scopes: ['asset'] },
  { key: 'A.5.15', version: 1, title: 'Access control', scopes: ['organization'] },
  { key: 'A.8.1', version: 1, title: 'User endpoint devices', scopes: ['asset'] },
  { key: 'A.8.5', version: 1, title: 'Secure authentication', scopes: ['asset'] },
  { key: 'A.8.7', version: 1, title: 'Protection against malware', scopes: ['asset'] },
  { key: 'A.8.9', version: 1, title: 'Configuration management', scopes: ['asset'] },
  { key: 'A.8.13', version: 1, title: 'Information backup', scopes: ['organization', 'asset'] },
  { key: 'A.8.16', version: 1, title: 'Monitoring activities', scopes: ['office'] },
  {
    key: 'A.8.19',
    version: 1,
    title: 'Installation of software on operational systems',
    scopes: ['organization', 'asset'],
  },
  { key: 'A.8.20', version: 1, title: 'Networks security', scopes: ['office', 'asset'] },
  { key: 'A.8.21', version: 1, title: 'Security of network services', scopes: ['asset'] },
  { key: 'A.8.22', version: 1, title: 'Segregation of networks', scopes: ['office'] },
] as const satisfies readonly ControlDefinition[]
