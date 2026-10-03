import {
  Building2,
  Cpu,
  Gauge,
  History,
  ListChecks,
  type LucideIcon,
  Package,
  Radar,
  Server,
  ShieldCheck,
} from 'lucide-react'
import type { StatusTone } from '@/components/ui/StatusBadge'

export const TASK_STATUS_LABELS: Record<string, string> = {
  planned: 'Planificada',
  pending: 'Pendiente',
  in_progress: 'En progreso',
  completed: 'Completada',
  cancelled: 'Cancelada',
}

export const TASK_STATUS_TONES: Record<string, StatusTone> = {
  planned: 'info',
  pending: 'neutral',
  in_progress: 'warning',
  completed: 'success',
  cancelled: 'danger',
}

export const TASK_PRIORITY_LABELS: Record<string, string> = {
  low: 'Baja',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
}

export const TASK_PRIORITY_TONES: Record<string, StatusTone> = {
  low: 'neutral',
  normal: 'info',
  high: 'warning',
  urgent: 'danger',
}

export const TASK_REFERENCE_LABELS: Record<string, string> = {
  offices: 'Inventario actual de una oficina',
  assets: 'Activo detectado en la red',
  'non-network-assets': 'Activo registrado manualmente',
  'assessment-instances': 'Ciclo de revisión de seguridad',
  'compliance-results': 'Resultado de un control',
  'inventory-snapshots': 'Instantánea histórica del inventario',
  'scan-reports': 'Ejecución de escaneo',
  'risk-evaluations': 'Cálculo histórico de riesgo',
  agents: 'Agente instalado en una oficina',
}

// Nombre corto del tipo, para chips y listados donde la etiqueta de la entidad va al lado.
export const TASK_REFERENCE_TYPE_LABELS: Record<string, string> = {
  offices: 'Inventario de oficina',
  assets: 'Activo de red',
  'non-network-assets': 'Activo manual',
  'assessment-instances': 'Revisión de seguridad',
  'compliance-results': 'Resultado de control',
  'inventory-snapshots': 'Instantánea',
  'scan-reports': 'Escaneo',
  'risk-evaluations': 'Evaluación de riesgo',
  agents: 'Agente',
}

export const TASK_REFERENCE_ICONS: Record<string, LucideIcon> = {
  offices: Building2,
  assets: Server,
  'non-network-assets': Package,
  'assessment-instances': ShieldCheck,
  'compliance-results': ListChecks,
  'inventory-snapshots': History,
  'scan-reports': Radar,
  'risk-evaluations': Gauge,
  agents: Cpu,
}

export const TASK_REFERENCE_HELP: Record<string, string> = {
  offices: 'El inventario vivo de la oficina seleccionada.',
  assets: 'Un equipo concreto descubierto mediante un escaneo.',
  'non-network-assets': 'Un activo concreto cargado manualmente.',
  'assessment-instances':
    'Un ciclo específico; permanece enlazado aunque luego se abra otro ciclo.',
  'compliance-results': 'El resultado puntual de un control evaluado.',
  'inventory-snapshots': 'Una copia inmutable del inventario en una fecha determinada.',
  'scan-reports': 'Un reporte generado por una ejecución concreta del agente.',
  'risk-evaluations': 'Un cálculo de riesgo correspondiente a una fecha determinada.',
  agents: 'La instalación del agente de escaneo de una oficina.',
}
