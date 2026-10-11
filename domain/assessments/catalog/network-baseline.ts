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
      'Este gateway ofrece la resolución de nombres (DNS) que normalmente usan los equipos de la oficina.',
    recommendation:
      'No hace falta hacer nada mientras siga siendo una función esperada del gateway.',
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
      'Este equipo acepta conexiones por un método antiguo que no protege la información transmitida.',
    recommendation:
      'Pide a quien mantiene el equipo que lo desactive o lo reemplace por un método de conexión protegido.',
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
    message: 'Este equipo permite acceso remoto y no se puede verificar que esté bien restringido.',
    recommendation:
      'Pide a quien mantiene este equipo que revise quién puede conectarse de forma remota.',
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
      'Este equipo comparte archivos en la red y no se puede verificar que el acceso esté bien restringido.',
    recommendation:
      'Pide a quien mantiene este equipo que revise quién puede acceder a sus archivos compartidos.',
  },
] as const satisfies readonly NetworkBaselineRule[]
