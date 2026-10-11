export const PORTAL_MESSAGE_TEMPLATES = [
  {
    key: 'portal_welcome',
    label: 'Bienvenida al portal',
    title: '¡Te damos la bienvenida al portal!',
    description:
      'Este es tu espacio para consultar la seguridad y el inventario de tu organización. Desde aquí podrás revisar avisos y dar seguimiento a las tareas que requieren tu atención.',
    message_type: 'notice',
  },
  {
    key: 'task_overdue',
    label: 'Tarea vencida',
    title: 'Tienes una tarea vencida',
    description: 'Revisa la tarea pendiente y completa los pasos indicados.',
    message_type: 'actionable',
  },
  {
    key: 'security_review',
    label: 'Revisión de seguridad',
    title: 'Hay una revisión de seguridad pendiente',
    description: 'Tu organización tiene una revisión que requiere atención.',
    message_type: 'actionable',
  },
  {
    key: 'general_announcement',
    label: 'Aviso general',
    title: 'Aviso importante',
    description: 'Tenemos una actualización importante para compartir.',
    message_type: 'notice',
  },
] as const

export type PortalMessageTemplateKey = (typeof PORTAL_MESSAGE_TEMPLATES)[number]['key']
