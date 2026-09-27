import type { AnswerOptionV2, RiskCatalogV2, RiskQuestionV2 } from './types'

const unknownOptions: AnswerOptionV2[] = [
  { key: 'unknown', label: 'No lo sé', efficacy: null },
  { key: 'not_applicable', label: 'No aplica', efficacy: null, requires_justification: true },
]

const options = (...items: Array<[string, string, number]>): AnswerOptionV2[] => [
  ...items.map(([key, label, efficacy]) => ({ key, label, efficacy })),
  ...unknownOptions,
]

const question = (
  definition: Omit<RiskQuestionV2, 'version' | 'policies'> & {
    policies?: RiskQuestionV2['policies']
  }
): RiskQuestionV2 => ({
  ...definition,
  version: 2,
  policies: definition.policies ?? ['essential', 'reinforced'],
})

export const RISK_QUESTIONS_V2 = [
  question({
    key: 'A.5.15.individual_accounts',
    control_key: 'A.5.15',
    scope: 'organization',
    prompt: '¿Cada persona usa su propia cuenta para acceder a los sistemas de la empresa?',
    help_text:
      'Responde Sí sólo si cada persona inicia sesión con una cuenta propia. Si comparten usuario o contraseña en algún sistema, responde No.',
    options: options(['yes', 'Sí', 1], ['no', 'No', 0]),
  }),
  question({
    key: 'A.5.15.access_revocation',
    control_key: 'A.5.15',
    scope: 'organization',
    prompt:
      '¿Se eliminan o ajustan los accesos cuando una persona deja la empresa o cambia de función?',
    help_text:
      'Responde Sí si los accesos se quitan o cambian apenas alguien se desvincula o cambia de tarea, también en el caso de proveedores.',
    options: options(['yes', 'Sí', 1], ['no', 'No', 0]),
  }),
  question({
    key: 'A.5.15.periodic_review',
    control_key: 'A.5.15',
    scope: 'organization',
    prompt: '¿Se revisa periódicamente quién conserva acceso a los sistemas?',
    help_text:
      'Responde Sí si existe una revisión programada y queda registro de quién conservó o perdió acceso; una planilla fechada es suficiente.',
    policies: ['reinforced'],
    options: options(['yes', 'Sí', 1], ['no', 'No', 0]),
  }),
  question({
    key: 'A.5.25.event_records',
    control_key: 'A.5.25',
    scope: 'organization',
    prompt: 'Cuando ocurre una falla o alerta de seguridad, ¿cómo se registra su resolución?',
    help_text:
      'Elige «Ticket o registro formal» si quedan anotados el problema, la fecha, el responsable y la solución en un lugar que luego pueda consultarse.',
    options: options(
      ['formal', 'Ticket o registro formal', 1],
      ['informal', 'Chat o comunicación informal', 0.4],
      ['none', 'No se registra', 0]
    ),
  }),
  question({
    key: 'A.7.9.physical_protection',
    control_key: 'A.7.9',
    scope: 'asset',
    prompt: 'Si este equipo se pierde o es robado, ¿cómo queda protegida su información?',
    help_text:
      'Elige «Disco cifrado y clave» sólo si verificaste que el cifrado está activo. Una contraseña para iniciar sesión, por sí sola, corresponde a «Sólo clave».',
    asset_types: ['workstation', 'mobile'],
    options: options(
      ['encrypted_and_locked', 'Disco cifrado y clave', 1],
      ['locked_only', 'Sólo clave', 0.6],
      ['none', 'Sin protección', 0]
    ),
  }),
  question({
    key: 'A.7.9.remote_actions',
    control_key: 'A.7.9',
    scope: 'asset',
    prompt: '¿La empresa puede rastrear, bloquear o borrar este equipo a distancia?',
    help_text:
      'Responde Sí sólo si la empresa tiene configurada y probada una función para localizar, bloquear o borrar el equipo aunque no lo tenga físicamente.',
    asset_types: ['workstation', 'mobile'],
    options: options(['managed', 'Sí', 1], ['none', 'No', 0]),
  }),
  question({
    key: 'A.8.1.exclusive_use',
    control_key: 'A.8.1',
    scope: 'asset',
    prompt: '¿Este equipo se utiliza exclusivamente para trabajo o se comparte con otras personas?',
    help_text:
      'Elige «Mayormente laboral» si lo usa una sola persona para trabajar, aunque ocasionalmente haga algo personal. Si lo usan familiares u otras personas, elige «Uso familiar o compartido».',
    asset_types: ['workstation', 'mobile'],
    options: options(
      ['work_only', 'Exclusivamente laboral', 1],
      ['mostly_work', 'Mayormente laboral', 0.7],
      ['shared', 'Uso familiar o compartido', 0]
    ),
  }),
  question({
    key: 'A.8.2.privileged_access',
    control_key: 'A.8.2',
    scope: 'asset',
    prompt: '¿Quiénes poseen acceso total de administrador o root a este equipo?',
    help_text:
      'Una cuenta administradora puede instalar programas, cambiar la seguridad y acceder a toda la información. Elige la opción según quién conoce o puede usar esas credenciales.',
    // ponytail: databases are servers; no inventory source reports a separate database type.
    asset_types: ['server', 'gateway'],
    options: options(
      ['exclusive_authorized', 'Personal exclusivo y autorizado', 1],
      ['multiple_as_needed', 'Varias personas o quien lo necesita', 0.4],
      ['generic_or_default', 'Clave genérica o predeterminada', 0]
    ),
  }),
  question({
    key: 'A.8.5.unlock',
    control_key: 'A.8.5',
    scope: 'asset',
    prompt: '¿El equipo exige una credencial para desbloquear la pantalla o iniciar sesión?',
    help_text:
      'Revisa qué pide el equipo al encenderlo o volver a usarlo. Elige la credencial que realmente exige, no la que podría configurarse.',
    asset_types: ['workstation', 'mobile', 'server'],
    options: options(
      ['biometric_or_token', 'Biometría o token', 1],
      ['strong_password', 'Contraseña alfanumérica', 0.8],
      ['simple_pin', 'Contraseña simple o PIN', 0.4],
      ['none', 'No exige credencial', 0]
    ),
  }),
  question({
    key: 'A.8.5.idle_lock',
    control_key: 'A.8.5',
    scope: 'asset',
    prompt: 'Si nadie usa el equipo durante un tiempo, ¿cuándo se bloquea automáticamente?',
    help_text:
      'Deja el equipo sin usar y comprueba cuánto tarda en bloquearse. Si sólo apaga la pantalla y permite volver sin una credencial, elige «No se bloquea».',
    asset_types: ['workstation', 'mobile', 'server'],
    options: options(
      ['under_3m', 'Antes de 3 minutos', 1],
      ['between_3m_10m', 'Entre 3 y 10 minutos', 0.6],
      ['over_10m', 'Después de 10 minutos', 0.3],
      ['none', 'No se bloquea', 0]
    ),
  }),
  question({
    key: 'A.8.7.protection_active',
    control_key: 'A.8.7',
    scope: 'asset',
    prompt: '¿La protección contra virus y aplicaciones dañinas está activa?',
    help_text:
      'Revisa el panel de seguridad del equipo. Elige «administrada formalmente» si la empresa puede ver y configurar la protección; «gestión personal» si depende del usuario.',
    asset_types: ['workstation', 'mobile', 'server'],
    options: options(
      ['centrally_managed', 'Sí, administrada formalmente', 1],
      ['locally_managed', 'Sí, con gestión personal', 0.7],
      ['none', 'No', 0]
    ),
  }),
  question({
    key: 'A.8.7.protection_updates',
    control_key: 'A.8.7',
    scope: 'asset',
    prompt: '¿Cómo se actualiza la protección de seguridad de este equipo?',
    help_text:
      'Elige «Automática y centralizada» si la empresa controla las actualizaciones; «Automática local» si el propio equipo las instala sin intervención.',
    asset_types: ['workstation', 'mobile', 'server'],
    options: options(
      ['automatic_central', 'Automática y centralizada', 1],
      ['automatic_local', 'Automática local', 0.8],
      ['manual', 'Manual', 0.4],
      ['none', 'No se actualiza', 0]
    ),
  }),
  question({
    key: 'A.8.9-20.default_password',
    control_key: 'A.8.9/A.8.20',
    scope: 'asset',
    prompt: '¿Se cambió la contraseña administrativa que el equipo traía de fábrica?',
    help_text:
      'Responde Sí sólo si la clave de administración original fue reemplazada por una clave propia. Cambiar únicamente la contraseña del Wi-Fi no cuenta.',
    asset_types: ['gateway', 'network_device'],
    options: options(['changed', 'Sí', 1], ['default', 'No', 0]),
  }),
  question({
    key: 'A.8.9-20.firmware',
    control_key: 'A.8.9/A.8.20',
    scope: 'asset',
    prompt: '¿Cómo se revisan e instalan las actualizaciones de firmware?',
    help_text:
      'Elige «Automática» sólo si el equipo instala o avisa regularmente sobre nuevas versiones. Si se revisa únicamente ante un problema, elige «Sólo ante fallos».',
    asset_types: ['gateway', 'network_device'],
    options: options(
      ['automatic', 'Automática y autónoma', 1],
      ['on_failure', 'Sólo ante fallos', 0.5],
      ['none', 'No se revisa ni actualiza', 0]
    ),
  }),
  question({
    key: 'A.8.13.backup',
    control_key: 'A.8.13',
    scope: 'asset',
    prompt: '¿Dónde se guarda principalmente la información de trabajo de este equipo?',
    help_text:
      'Elige dónde se guardan normalmente los archivos. «Disco local con copia periódica» requiere una segunda copia actualizada y separada del equipo.',
    asset_types: ['workstation', 'mobile', 'server'],
    options: options(
      ['corporate_cloud', 'Nube corporativa', 1],
      ['local_with_backup', 'Disco local con copia periódica', 0.5],
      ['personal_cloud', 'Nube personal o compartida', 0.3],
      ['local_only', 'Sólo disco local', 0]
    ),
  }),
  question({
    key: 'A.8.15.audit_logs',
    control_key: 'A.8.15',
    scope: 'office',
    prompt: '¿Los equipos relevantes guardan un historial de inicios de sesión y cambios?',
    help_text:
      'Responde Sí si se puede consultar quién inició sesión y qué cambios importantes realizó. Un mensaje enviado por chat no cuenta como historial del equipo.',
    // Ficha A.8.15: office answer inherited by servers, gateways and routers; a per-asset answer
    // overrides it (plan §3.2).
    asset_types: ['server', 'gateway', 'network_device'],
    options: options(
      ['centralized', 'Sí, automática y centralizada', 1],
      ['local', 'Sí, dentro de cada equipo', 0.6],
      ['none', 'No', 0]
    ),
  }),
  question({
    key: 'A.8.19.software_installation',
    control_key: 'A.8.19',
    scope: 'asset',
    prompt: '¿Qué ocurre cuando alguien intenta instalar una aplicación en este equipo?',
    help_text:
      'Intenta pensar qué pasa en la práctica: si hace falta autorización o una clave de administrador, elige la primera opción; si cualquier persona puede instalar, elige «Se instala directamente».',
    asset_types: ['workstation', 'mobile', 'server'],
    options: options(
      ['restricted', 'Requiere aprobación o contraseña', 1],
      ['warning_only', 'Sólo muestra una advertencia o registra la acción', 0.5],
      ['direct', 'Se instala directamente', 0]
    ),
  }),
  question({
    key: 'A.8.22.guest_wifi',
    control_key: 'A.8.22',
    scope: 'office',
    prompt:
      '¿Las visitas y dispositivos personales usan una red separada de los equipos de trabajo?',
    help_text:
      'Responde Sí sólo si las visitas usan una red desde la que no pueden ver impresoras, computadoras, servidores ni otros equipos de trabajo.',
    options: options(['yes', 'Sí', 1], ['no', 'No', 0]),
  }),
  question({
    key: 'A.8.22.network_zones',
    control_key: 'A.8.22',
    scope: 'office',
    prompt: '¿Existe un registro actualizado de qué red debe usar cada tipo de dispositivo?',
    help_text:
      'Responde Sí si existe una lista vigente que indique, por ejemplo, qué red usan las computadoras, las visitas, las impresoras y las cámaras.',
    policies: ['reinforced'],
    options: options(['yes', 'Sí', 1], ['no', 'No', 0]),
  }),
] as const satisfies readonly RiskQuestionV2[]

export const RISK_CONTROLS_V2 = [
  { key: 'A.5.9', title: 'Inventario de activos', severity: 'coverage_only', question_keys: [] },
  {
    key: 'A.5.12',
    title: 'Clasificación de la información',
    severity: 'coverage_only',
    question_keys: [],
  },
  {
    key: 'A.5.15',
    title: 'Control de acceso',
    severity: 'high',
    question_keys: [
      'A.5.15.individual_accounts',
      'A.5.15.access_revocation',
      'A.5.15.periodic_review',
    ],
  },
  {
    key: 'A.5.25',
    title: 'Evaluación de eventos',
    severity: 'low',
    question_keys: ['A.5.25.event_records'],
  },
  {
    key: 'A.7.9',
    title: 'Activos fuera de las instalaciones',
    severity: 'medium',
    question_keys: ['A.7.9.physical_protection', 'A.7.9.remote_actions'],
  },
  {
    key: 'A.8.1',
    title: 'Dispositivos terminales',
    severity: 'medium',
    question_keys: ['A.8.1.exclusive_use'],
  },
  {
    key: 'A.8.2',
    title: 'Accesos privilegiados',
    severity: 'critical',
    question_keys: ['A.8.2.privileged_access'],
  },
  {
    key: 'A.8.5',
    title: 'Autenticación segura',
    severity: 'medium',
    question_keys: ['A.8.5.unlock', 'A.8.5.idle_lock'],
  },
  {
    key: 'A.8.7',
    title: 'Protección contra malware',
    severity: 'high',
    question_keys: ['A.8.7.protection_active', 'A.8.7.protection_updates'],
  },
  {
    key: 'A.8.9/A.8.20',
    title: 'Configuración de red y firmware',
    severity: 'high',
    question_keys: ['A.8.9-20.default_password', 'A.8.9-20.firmware'],
  },
  {
    key: 'A.8.13',
    title: 'Copias de seguridad',
    severity: 'high',
    question_keys: ['A.8.13.backup'],
  },
  {
    key: 'A.8.15',
    title: 'Registros de eventos',
    severity: 'medium',
    question_keys: ['A.8.15.audit_logs'],
  },
  { key: 'A.8.16', title: 'Actividades de monitoreo', severity: 'high', question_keys: [] },
  {
    key: 'A.8.19',
    title: 'Instalación de software',
    severity: 'medium',
    question_keys: ['A.8.19.software_installation'],
  },
  { key: 'A.8.20', title: 'Shadow IT', severity: 'high', question_keys: [] },
  { key: 'A.8.21', title: 'Servicios de red', severity: 'by_network_rule', question_keys: [] },
  {
    key: 'A.8.22',
    title: 'Segregación de redes',
    severity: 'high',
    question_keys: ['A.8.22.guest_wifi', 'A.8.22.network_zones'],
  },
] as const

export const RISK_CONDITIONAL_RULES_V2 = [
  {
    key: 'A.8.5.no_unlock_forces_idle_zero',
    control_key: 'A.8.5',
    input_question_keys: ['A.8.5.unlock'],
    operation: 'force_zero',
    when_option_key: 'none',
    target_question_key: 'A.8.5.idle_lock',
    value: 0,
  },
  {
    key: 'A.8.7.no_protection_forces_updates_zero',
    control_key: 'A.8.7',
    input_question_keys: ['A.8.7.protection_active'],
    operation: 'force_zero',
    when_option_key: 'none',
    target_question_key: 'A.8.7.protection_updates',
    value: 0,
  },
  {
    key: 'A.8.9-20.default_password_reduces_firmware',
    control_key: 'A.8.9/A.8.20',
    input_question_keys: ['A.8.9-20.default_password'],
    operation: 'multiply',
    when_option_key: 'default',
    target_question_key: 'A.8.9-20.firmware',
    value: 0.5,
  },
  // ponytail: A.7.9 "cap 0.5 when one dimension is 0" needs no rule — averaging two values in 0..1
  // with one at 0 can never exceed 0.5. Covered by control-efficacy.test.ts.
] as const

export const RISK_CATALOG_V2 = {
  version: 2,
  questions: RISK_QUESTIONS_V2,
  controls: RISK_CONTROLS_V2,
  conditional_rules: RISK_CONDITIONAL_RULES_V2,
} as const satisfies RiskCatalogV2
