// Catálogo de AuditLog: categorías y acciones (documentation/planes/audit-log/01-alcance-y-categorias.md §2).
// Es la fuente única de los códigos que se persisten en `category_code`/`action_code`. Solo datos, sin
// lógica. Reglas del plan:
// - Un código nunca se reutiliza ni cambia de significado. Si una acción deja de existir, se conserva
//   con `retired: true` para seguir mostrando eventos viejos.
// - Cada acción pertenece a una sola categoría (lo comprueba catalog.test.ts).
// - `orgLevelVisibleToOfficeRoles`: un evento sin oficina (office_ids vacío) es visible para
//   OfficeManager solo si la acción lo declara (documento 04 §2). Por defecto, denegado.
// La ficha completa de cada acción (campos permitidos, proyección, sensibilidad, transacción) se
// agrega en la fase que implementa su módulo (ver PLAN-AUDITLOG / documento 06 §2).

export const AUDIT_CATEGORIES = {
  organization_lifecycle: 'Gestión de organizaciones',
  office_lifecycle: 'Gestión de oficinas',
  member_access: 'Gestión de personas y accesos',
  account_access: 'Accesos a cuentas',
  profile_changes: 'Cambios de perfil',
  organization_settings: 'Configuración de la organización',
  asset_lifecycle: 'Gestión de activos',
  asset_changes: 'Modificación de activos',
  assessment_scope: 'Alcance de evaluaciones',
  inventory_incidents: 'Incidentes de inventario',
  scanner_management: 'Gestión de escáneres',
  scan_processing: 'Procesamiento de escaneos',
  inventory_evidence: 'Evidencias de inventario',
  assessment_lifecycle: 'Gestión de evaluaciones',
  compliance_results: 'Resultados de cumplimiento',
  task_creation: 'Creación de tareas',
  task_editing: 'Edición de tareas',
  task_lifecycle: 'Estado de tareas',
  risk_processing: 'Cálculo de riesgo',
  portal_messages: 'Mensajes del portal',
  platform_visits: 'Visitas a organizaciones',
  data_access: 'Acceso a información sensible',
  exports: 'Exportaciones',
  ai_processing: 'Envíos a IA',
  maintenance: 'Mantenimiento y conservación',
} as const

export type AuditCategoryCode = keyof typeof AUDIT_CATEGORIES

export type AuditEntityType =
  | 'organization'
  | 'office'
  | 'member'
  | 'account'
  | 'user'
  | 'platform_admin'
  | 'organization_settings'
  | 'asset'
  | 'manual_asset'
  | 'inventory_incident'
  | 'agent'
  | 'scan_report'
  | 'inventory_snapshot'
  | 'assessment'
  | 'compliance_result'
  | 'task'
  | 'risk_evaluation'
  | 'portal_message'
  | 'platform_visit'
  | 'audit_log'
  | 'export'
  | 'ai_request'
  | 'job'
  | 'operation'

export interface AuditActionSpec {
  code: string
  category: AuditCategoryCode
  label: string
  entity: AuditEntityType
  orgLevelVisibleToOfficeRoles?: true
  retired?: true
}

// `const C` conserva el literal del código para derivar el tipo AuditActionCode.
function action<const C extends string>(
  code: C,
  category: AuditCategoryCode,
  label: string,
  entity: AuditEntityType,
  options: { orgLevelVisibleToOfficeRoles?: true; retired?: true } = {}
) {
  return { code, category, label, entity, ...options }
}

const OFFICE_VISIBLE = { orgLevelVisibleToOfficeRoles: true } as const

export const AUDIT_ACTIONS = [
  // Gestión de organizaciones
  action('organization.create', 'organization_lifecycle', 'Organización creada', 'organization'),
  action(
    'organization.update',
    'organization_lifecycle',
    'Organización modificada',
    'organization',
    OFFICE_VISIBLE
  ),
  action(
    'organization.deactivate',
    'organization_lifecycle',
    'Organización desactivada',
    'organization'
  ),
  action(
    'organization.reactivate',
    'organization_lifecycle',
    'Organización reactivada',
    'organization'
  ),
  action('subscription.change_level', 'organization_lifecycle', 'Cambio de nivel', 'organization'),

  // Gestión de oficinas
  action('office.create', 'office_lifecycle', 'Oficina creada', 'office'),
  action('office.update', 'office_lifecycle', 'Oficina modificada', 'office'),
  action('office.deactivate', 'office_lifecycle', 'Oficina desactivada', 'office'),
  action('office.reactivate', 'office_lifecycle', 'Oficina reactivada', 'office'),

  // Gestión de personas y accesos
  action('member.create', 'member_access', 'Persona creada', 'member'),
  action('member.update', 'member_access', 'Persona modificada', 'member'),
  action('member.change_role', 'member_access', 'Cambio de rol', 'member'),
  action('member.change_offices', 'member_access', 'Cambio de oficinas', 'member'),
  action('member.deactivate', 'member_access', 'Persona desactivada', 'member'),
  action('member.reactivate', 'member_access', 'Persona reactivada', 'member'),
  action('account.revoke_sessions', 'member_access', 'Sesiones cerradas', 'account'),

  // Accesos a cuentas (bloqueado hasta Descope: documento 01 §5)
  action('account.login', 'account_access', 'Inicio de sesión', 'account'),
  action(
    'account.login_denied_inactive',
    'account_access',
    'Ingreso rechazado: cuenta inactiva',
    'account'
  ),
  action('account.lock', 'account_access', 'Cuenta bloqueada', 'account'),
  action(
    'account.login_while_locked',
    'account_access',
    'Intento sobre cuenta bloqueada',
    'account'
  ),

  // Cambios de perfil
  action('user.update_profile', 'profile_changes', 'Perfil modificado', 'user'),
  action(
    'platform_admin.update_profile',
    'profile_changes',
    'Perfil de administrador modificado',
    'platform_admin'
  ),

  // Configuración de la organización
  action(
    'settings.update_inventory',
    'organization_settings',
    'Configuración de inventario modificada',
    'organization_settings'
  ),
  action(
    'settings.update_maturity',
    'organization_settings',
    'Perfil de madurez modificado',
    'organization_settings'
  ),
  action(
    'settings.update_assessment_policy',
    'organization_settings',
    'Política de evaluaciones modificada',
    'organization_settings'
  ),

  // Gestión de activos
  action('asset.discover', 'asset_lifecycle', 'Activo descubierto', 'asset'),
  action('asset.identify', 'asset_lifecycle', 'Activo identificado', 'asset'),
  action('asset.unidentify', 'asset_lifecycle', 'Identificación revertida', 'asset'),
  action('manual_asset.create', 'asset_lifecycle', 'Activo manual creado', 'manual_asset'),
  action('asset.retire', 'asset_lifecycle', 'Activo retirado', 'asset'),
  action('asset.reactivate', 'asset_lifecycle', 'Reactivación de activo', 'asset'),
  action('asset.delete_logically', 'asset_lifecycle', 'Activo eliminado del inventario', 'asset'),
  action('asset.move', 'asset_lifecycle', 'Activo trasladado', 'asset'),

  // Modificación de activos
  action('asset.update_business', 'asset_changes', 'Datos de negocio modificados', 'asset'),
  action('manual_asset.update', 'asset_changes', 'Activo manual modificado', 'manual_asset'),
  action('asset.update_technical', 'asset_changes', 'Datos técnicos actualizados', 'asset'),
  action('asset.change_presence', 'asset_changes', 'Cambio de presencia', 'asset'),
  action('asset.change_owner', 'asset_changes', 'Cambio de responsable', 'asset'),
  action('asset.review', 'asset_changes', 'Revisión de activo confirmada', 'manual_asset'),

  // Alcance de evaluaciones
  action('assessment_scope.exclude', 'assessment_scope', 'Activo excluido de revisiones', 'asset'),
  action('assessment_scope.include', 'assessment_scope', 'Activo incluido en revisiones', 'asset'),
  action('assessment_scope.expire_exclusion', 'assessment_scope', 'Exclusión vencida', 'asset'),
  action(
    'assessment_scope.change_applicability',
    'assessment_scope',
    'Cambio de aplicabilidad',
    'asset'
  ),

  // Incidentes de inventario
  action(
    'inventory_incident.create',
    'inventory_incidents',
    'Incidente de inventario creado',
    'inventory_incident'
  ),
  action(
    'inventory_incident.resolve',
    'inventory_incidents',
    'Incidente de inventario resuelto',
    'inventory_incident'
  ),
  action(
    'inventory_incident.confirm_move',
    'inventory_incidents',
    'Traslado confirmado',
    'inventory_incident'
  ),

  // Gestión de escáneres
  action('agent.provision', 'scanner_management', 'Escáner dado de alta', 'agent'),
  action(
    'agent.package_generated',
    'scanner_management',
    'Paquete de instalación generado',
    'agent'
  ),
  action('agent.activate', 'scanner_management', 'Escáner conectado por primera vez', 'agent'),
  action('agent.revoke', 'scanner_management', 'Escáner revocado', 'agent'),
  action('agent.lock', 'scanner_management', 'Escáner bloqueado temporalmente', 'agent'),
  action(
    'agent.revoke_after_lockouts',
    'scanner_management',
    'Escáner revocado por bloqueos repetidos',
    'agent'
  ),

  // Procesamiento de escaneos
  action('scan.receive', 'scan_processing', 'Reporte de escaneo recibido', 'scan_report'),
  action('scan.process', 'scan_processing', 'Reporte de escaneo procesado', 'scan_report'),
  action('scan.record_failure', 'scan_processing', 'Escaneo fallido informado', 'scan_report'),
  action('scan.record_partial', 'scan_processing', 'Escaneo parcial informado', 'scan_report'),

  // Evidencias de inventario
  action('snapshot.create', 'inventory_evidence', 'Instantánea creada', 'inventory_snapshot'),
  action('snapshot.rename', 'inventory_evidence', 'Instantánea renombrada', 'inventory_snapshot'),
  action('scan.rename', 'inventory_evidence', 'Reporte renombrado', 'scan_report'),

  // Gestión de evaluaciones
  action('assessment.create_cycle', 'assessment_lifecycle', 'Creación de ciclo', 'assessment'),
  action('assessment.save_draft', 'assessment_lifecycle', 'Borrador guardado', 'assessment'),
  action('assessment.complete', 'assessment_lifecycle', 'Evaluación completada', 'assessment'),
  action('assessment.reopen', 'assessment_lifecycle', 'Evaluación reabierta', 'assessment'),
  action('assessment.expire', 'assessment_lifecycle', 'Evaluación vencida', 'assessment'),
  action('assessment.supersede', 'assessment_lifecycle', 'Ciclo sustituido', 'assessment'),
  action('assessment.bulk_complete', 'assessment_lifecycle', 'Respuesta múltiple', 'operation'),

  // Resultados de cumplimiento (sin assessment.inherit_answers: decidido 2026-11-14)
  action(
    'compliance.evaluate_manual',
    'compliance_results',
    'Resultado de cumplimiento manual',
    'compliance_result'
  ),
  action(
    'compliance.evaluate_automatic',
    'compliance_results',
    'Resultado de cumplimiento automático',
    'compliance_result'
  ),

  // Tareas: las globales (sin oficina) son visibles para roles de oficina (documento 04 §2)
  action('task.create', 'task_creation', 'Tarea creada', 'task', OFFICE_VISIBLE),
  action('task.create_multiple', 'task_creation', 'Tareas creadas', 'operation', OFFICE_VISIBLE),
  action('task.edit', 'task_editing', 'Tarea modificada', 'task', OFFICE_VISIBLE),
  action('task.reassign', 'task_editing', 'Reasignación', 'task', OFFICE_VISIBLE),
  action('task.replan', 'task_editing', 'Replanificación', 'task', OFFICE_VISIBLE),
  action('task.claim', 'task_lifecycle', 'Tarea tomada', 'task', OFFICE_VISIBLE),
  action('task.release', 'task_lifecycle', 'Tarea liberada', 'task', OFFICE_VISIBLE),
  action('task.complete', 'task_lifecycle', 'Tarea completada', 'task', OFFICE_VISIBLE),
  action(
    'task.force_complete',
    'task_lifecycle',
    'Tarea completada por gestor',
    'task',
    OFFICE_VISIBLE
  ),
  action('task.cancel', 'task_lifecycle', 'Tarea cancelada', 'task', OFFICE_VISIBLE),
  action('task.archive', 'task_lifecycle', 'Tarea archivada', 'task', OFFICE_VISIBLE),
  action('task.delete', 'task_lifecycle', 'Tarea eliminada', 'task', OFFICE_VISIBLE),

  // Cálculo de riesgo
  action(
    'risk.persist_evaluation',
    'risk_processing',
    'Evaluación de riesgo guardada',
    'risk_evaluation'
  ),

  // Mensajes del portal
  action('portal_message.create', 'portal_messages', 'Mensaje creado', 'portal_message'),
  action('portal_message.update', 'portal_messages', 'Mensaje modificado', 'portal_message'),
  action('portal_message.activate', 'portal_messages', 'Mensaje activado', 'portal_message'),
  action('portal_message.deactivate', 'portal_messages', 'Mensaje desactivado', 'portal_message'),
  action('portal_message.replay', 'portal_messages', 'Mensaje reenviado', 'portal_message'),
  action('portal_message.seen', 'portal_messages', 'Mensaje visto', 'portal_message'),
  action('portal_message.dismissed', 'portal_messages', 'Mensaje descartado', 'portal_message'),

  // Visitas a organizaciones
  action('platform_visit.start', 'platform_visits', 'Ingreso de PlatformAdmin', 'platform_visit'),
  action('platform_visit.end', 'platform_visits', 'Salida de PlatformAdmin', 'platform_visit'),

  // Acceso a información sensible (cerrado 2026-11-14)
  action('technical_evidence.access', 'data_access', 'Acceso a evidencia técnica', 'scan_report'),
  action(
    'audit.network_details_access',
    'data_access',
    'Acceso a datos de red de la bitácora',
    'audit_log'
  ),
  action(
    'audit.platform_read',
    'data_access',
    'Consulta de la bitácora desde plataforma',
    'audit_log'
  ),
  action('audit.integrity_check', 'data_access', 'Verificación de integridad', 'audit_log'),

  // Exportaciones
  action('audit.export', 'exports', 'Exportación de la bitácora', 'export'),

  // Envíos a IA (plan capa-llm)
  action('ai.explanation_generated', 'ai_processing', 'Explicación generada por IA', 'ai_request'),
  action(
    'ai.asset_type_suggested',
    'ai_processing',
    'Tipo de activo sugerido por IA',
    'ai_request'
  ),

  // Mantenimiento y conservación
  action(
    'retention.expire_technical_evidence',
    'maintenance',
    'Evidencia técnica vencida',
    'scan_report'
  ),
  action('retention.expire_network_context', 'maintenance', 'Contexto de red vencido', 'audit_log'),
  action('jobs.recover', 'maintenance', 'Recuperación de tareas programadas', 'job'),
  action('demo.generate', 'maintenance', 'Generación de datos demo', 'operation'),
] as const satisfies readonly AuditActionSpec[]

export type AuditActionCode = (typeof AUDIT_ACTIONS)[number]['code']
