import {
  Boxes,
  CircleAlert,
  ClipboardCheck,
  Gauge,
  Info,
  LayoutDashboard,
  ListTodo,
  type LucideIcon,
  ShieldCheck,
} from 'lucide-react'
import type { StatusTone } from '@/components/ui/StatusBadge'
import { TASK_REFERENCE_ICONS, TASK_REFERENCE_TYPE_LABELS } from '@/modules/tasks/task-labels'
import type { PORTAL_MESSAGE_SECTIONS, PortalMessageEntityTypes } from './schema'

type Section = (typeof PORTAL_MESSAGE_SECTIONS)[number]
type EntityType = (typeof PortalMessageEntityTypes)[number]

// Mismos íconos y nombres que el menú del portal (app/portal/(protected)/layout.tsx).
export const PORTAL_MESSAGE_SECTION_LINKS: Record<
  Section,
  { label: string; href: string; icon: LucideIcon }
> = {
  dashboard: { label: 'Panel general', href: '/portal/dashboard', icon: LayoutDashboard },
  'risk-score': { label: 'Puntaje de riesgo', href: '/portal/risk-score', icon: Gauge },
  'security-review': {
    label: 'Revisión de seguridad',
    href: '/portal/security-review',
    icon: ClipboardCheck,
  },
  tasks: { label: 'Tareas', href: '/portal/tasks', icon: ListTodo },
  inventory: { label: 'Inventario', href: '/portal/inventory', icon: Boxes },
  administration: {
    label: 'Administración',
    href: '/portal/administration',
    icon: ShieldCheck,
  },
}

export const PORTAL_MESSAGE_ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  tasks: 'Tarea',
  ...(TASK_REFERENCE_TYPE_LABELS as Record<Exclude<EntityType, 'tasks'>, string>),
}

export const PORTAL_MESSAGE_ENTITY_ICONS: Record<EntityType, LucideIcon> = {
  tasks: ListTodo,
  ...(TASK_REFERENCE_ICONS as Record<Exclude<EntityType, 'tasks'>, LucideIcon>),
}

/** Tipo + ícono de lo que enlaza un mensaje: una sección del portal o una entidad concreta. */
export function portalMessageLinkType(link: { kind: 'section' | 'entity'; relationTo: string }) {
  if (link.kind === 'section') {
    const section = PORTAL_MESSAGE_SECTION_LINKS[link.relationTo as Section]
    return { label: 'Sección', icon: section?.icon ?? LayoutDashboard }
  }
  return {
    label: PORTAL_MESSAGE_ENTITY_TYPE_LABELS[link.relationTo as EntityType] ?? link.relationTo,
    icon: PORTAL_MESSAGE_ENTITY_ICONS[link.relationTo as EntityType] ?? LayoutDashboard,
  }
}

export const PORTAL_MESSAGE_TYPE_LABELS = { notice: 'Aviso', actionable: 'Accionable' } as const
/** Lo mismo en palabras de quien recibe el mensaje ("Accionable" es jerga del panel). */
export const PORTAL_MESSAGE_RECIPIENT_TYPE_LABELS = {
  notice: 'Aviso',
  actionable: 'Acción requerida',
} as const
export const PORTAL_MESSAGE_TYPE_TONES: Record<'notice' | 'actionable', StatusTone> = {
  notice: 'info',
  actionable: 'warning',
}
export const PORTAL_MESSAGE_TYPE_ICONS: Record<'notice' | 'actionable', LucideIcon> = {
  notice: Info,
  actionable: CircleAlert,
}

export type PortalMessageStatus = 'active' | 'expired' | 'inactive'
export const PORTAL_MESSAGE_STATUS_LABELS: Record<PortalMessageStatus, string> = {
  active: 'Vigente',
  expired: 'Vencido',
  inactive: 'Inactivo',
}
export const PORTAL_MESSAGE_STATUS_TONES: Record<PortalMessageStatus, StatusTone> = {
  active: 'success',
  expired: 'warning',
  inactive: 'neutral',
}

export function portalMessageStatus(
  message: { is_active: boolean; expires_at?: string | null },
  now = Date.now()
): PortalMessageStatus {
  if (!message.is_active) return 'inactive'
  if (message.expires_at && Date.parse(message.expires_at) <= now) return 'expired'
  return 'active'
}

// Un mensaje leído deja de verse en el panel cuando tiene más de este tiempo de antigüedad;
// uno sin leer se muestra siempre (y ninguno se ve una vez desactivado o vencido).
export const PORTAL_MESSAGE_HISTORY_DAYS = 30

export function isInPortalMessageHistory(
  message: { seen: boolean; createdAt?: string },
  now = Date.now()
) {
  if (!message.seen || !message.createdAt) return true
  return now - Date.parse(message.createdAt) <= PORTAL_MESSAGE_HISTORY_DAYS * 86_400_000
}
