type ErrorLike = {
  code?: unknown
  message?: unknown
}

const MESSAGES_BY_CODE: Record<string, string> = {
  already_claimed: 'Otra persona ya reclamó esta tarea. Actualiza la lista.',
  task_not_found: 'La tarea ya no está disponible. Actualiza la lista.',
  task_terminal: 'La tarea ya finalizó o fue cancelada y no admite cambios.',
  task_not_pending: 'La tarea ya no está pendiente. Actualiza la lista.',
  task_planned: 'La tarea todavía no llegó a su fecha de inicio.',
  not_eligible: 'No puedes reclamar esta tarea con tu acceso actual.',
  not_claimant: 'Solo quien está realizando la tarea puede completarla o liberarla.',
  task_completed_by_admin: 'La tarea ya fue completada por un administrador. Revisa su actividad.',
  task_already_completed: 'La tarea ya fue completada. Revisa su actividad.',
  task_cancelled: 'La tarea fue cancelada y ya no se puede completar ni liberar.',
  task_state_changed: 'La tarea ya no está en curso. Revisa su estado actualizado.',
  task_not_force_completable: 'La tarea debe estar en curso y reclamada por otra persona.',
  task_not_in_progress: 'Solo puedes cancelar tareas en curso.',
  task_not_terminal: 'Solo puedes archivar tareas completadas o canceladas.',
  task_cannot_be_deleted: 'Solo puedes eliminar tareas pendientes que nunca fueron reclamadas.',
  no_eligible_assignees: 'No hay personas con acceso para realizar esta tarea.',
  related_entity_not_found: 'El elemento relacionado ya no está disponible.',
  related_entity_without_organization:
    'No se pudo identificar la organización del elemento relacionado.',
  asset_unavailable: 'El activo está retirado o eliminado y no admite nuevas tareas.',
  invalid_dates: 'La fecha de vencimiento debe ser igual o posterior a la de inicio.',
  invalid_scope: 'El alcance seleccionado no es válido para esta tarea.',
  scope_required: 'Selecciona las oficinas de la tarea.',
  organization_context_required: 'Entra a una organización para realizar esta acción.',
  organization_inactive:
    'La organización está inactiva. Pide su reactivación al administrador de la plataforma.',
  organization_not_found: 'La organización ya no está disponible. Actualiza la lista.',
  organization_settings_missing:
    'No se encontró la configuración de la organización. Contacta al administrador de la plataforma.',
  member_not_found: 'La persona ya no está disponible en esta organización. Actualiza la lista.',
  invalid_role: 'Selecciona un rol válido.',
  invalid_offices:
    'Revisa que las oficinas seleccionadas estén activas y correspondan a la organización y al rol.',
  offices_required: 'Selecciona al menos una oficina activa.',
  office_out_of_scope: 'Solo puedes asignar oficinas que administras.',
  cannot_deactivate_self: 'No puedes desactivar tu propia cuenta.',
  confirmation_required: 'Completa el texto solicitado para confirmar.',
  confirmation_mismatch:
    'El texto de confirmación no coincide. Revisa el nombre o correo solicitado.',
  invalid_replacement: 'Selecciona otra persona activa como responsable.',
  office_not_found: 'La oficina ya no está disponible. Actualiza la lista.',
  office_not_available: 'La oficina no está disponible o está inactiva.',
  office_inactive: 'Reactiva la oficina antes de realizar esta acción.',
  office_limit_reached: 'Alcanzaste el límite de oficinas activas de tu plan.',
  last_active_office: 'La organización debe conservar al menos una oficina activa.',
  impact_changed: 'Los activos de la oficina cambiaron. Revisa el impacto antes de confirmar.',
  invalid_destination: 'Selecciona otra oficina activa de la organización para cada activo.',
  no_admin_available:
    'No hay un administrador disponible para reactivar la organización. Contacta al administrador de la plataforma.',
  no_office_available: 'La organización necesita una oficina para poder reactivarse.',
  agent_limit_reached: 'Alcanzaste el límite de escáneres de tu plan.',
  subscription_not_found:
    'La organización no tiene una suscripción configurada. Contacta al administrador de la plataforma.',
  platform_invalid: 'Selecciona un sistema operativo compatible para el escáner.',
  asset_not_identified: 'Identifica el activo antes de modificar sus datos.',
  review_not_due_yet: 'Todavía no corresponde realizar una nueva revisión de este activo.',
  bulk_preview_stale: 'Las revisiones cambiaron. Vuelve a revisar los activos incluidos.',
  bulk_selection_stale: 'La selección cambió. Vuelve a revisar los activos incluidos.',
  policy_version_unavailable:
    'La política de revisión seleccionada ya no está disponible. Actualiza la página.',
  message_not_found: 'El mensaje ya no está disponible. Actualiza la lista.',
  message_inactive_or_expired: 'El mensaje está inactivo o venció.',
  invalid_entity_scope: 'El elemento relacionado no pertenece al alcance del mensaje.',
  email_unavailable: 'Ese correo ya está asociado a una cuenta. Escribe otro correo.',
  asset_excluded_from_assessments:
    'Este activo está excluido de las revisiones de seguridad y no admite respuestas.',
  assessment_already_open: 'Ya hay una revisión de seguridad abierta para este activo.',
  asset_changed: 'El activo cambió. Actualiza la vista antes de decidir.',
  feature_disabled: 'Esta función no está habilitada para la organización.',
  forbidden: 'No tienes permiso para realizar esta acción.',
  last_active_org_admin: 'La organización debe conservar al menos un administrador activo.',
  rank_escalation: 'No puedes asignar un rol de mayor autoridad que el tuyo.',
  unauthenticated: 'Tu sesión venció. Inicia sesión nuevamente.',
  user_limit_reached: 'Alcanzaste el límite de personas activas para este rol en tu plan.',
}

function translateKnownMessage(message: string): string | undefined {
  if (message === 'La categoría de este activo manual no admite revisiones de seguridad.')
    return message
  if (
    /^La pregunta .+ (?:ya no está disponible|no está disponible para esta política|no forma parte de esta revisión)/.test(
      message
    )
  )
    return 'Una pregunta de la revisión cambió. Actualiza la página.'
  if (message.startsWith('La respuesta elegida ya no está disponible para la pregunta '))
    return 'Una respuesta ya no está disponible. Actualiza la revisión y selecciona otra.'
  if (message.startsWith('Responde todas las preguntas visibles '))
    return 'Responde todas las preguntas visibles para completar la revisión.'
  if (/^La revisión (?:pendiente|en curso) no se puede modificar\.$/.test(message))
    return 'La revisión cambió de estado y ya no admite cambios. Actualiza la página.'
  if (
    message.startsWith('El campo ') ||
    message.startsWith('El activo ') ||
    message.startsWith('La revisión ') ||
    message.startsWith('La respuesta ') ||
    message.startsWith('La pregunta ') ||
    message.startsWith('La oficina ') ||
    message.startsWith('Los activos ') ||
    message.startsWith('Solo las computadoras ') ||
    message.startsWith('Justifica por qué ') ||
    message.startsWith('Ya existe una revisión ') ||
    message.startsWith('Ya existe una respuesta ') ||
    message.startsWith('Este activo todavía no fue identificado:') ||
    message.startsWith('La oficina elegida está inactiva.') ||
    message === 'Selecciona un responsable.' ||
    message === 'Selecciona un responsable para la nueva oficina.' ||
    message.startsWith('La oficina de este activo está inactiva:') ||
    message.startsWith('Un activo eliminado conserva su baja y su historial.') ||
    message.startsWith('Los activos se eliminan lógicamente para conservar su historial.') ||
    message.startsWith('Responde todas las preguntas visibles ') ||
    message.startsWith('Este activo está excluido de las revisiones ')
  ) {
    return message
  }

  if (message === 'Only active manually entered computers can receive assessment cycles') {
    return 'Solo las computadoras manuales activas pueden recibir ciclos de evaluación.'
  }
  if (message === 'Only manually entered computers can receive assessment results') {
    return 'Solo las computadoras manuales pueden recibir resultados de evaluación.'
  }
  if (message === 'Retired assets cannot receive assessment cycles') {
    return 'Los activos dados de baja no pueden recibir ciclos de evaluación.'
  }
  if (message === 'Not applicable answers require a justification') {
    return 'Justifica por qué esta respuesta no aplica.'
  }
  if (message === 'An open assessment already exists for this policy and target') {
    return 'Ya existe una revisión abierta para este alcance y esta política.'
  }

  const questionUnavailable = message.match(/^Question (.+) v(\d+) is unavailable$/)
  if (questionUnavailable) {
    return 'Una pregunta de la revisión ya no está disponible. Actualiza la página.'
  }
  const questionPolicy = message.match(/^Question (.+) is not available for this policy$/)
  if (questionPolicy) return 'Una pregunta ya no corresponde a esta revisión. Actualiza la página.'
  const optionUnavailable = message.match(/^Option (.+) is not available for (.+)$/)
  if (optionUnavailable)
    return 'La respuesta seleccionada ya no está disponible para esta pregunta.'
  const assessmentStatus = message.match(/^Assessment in status (.+) cannot be changed$/)
  if (assessmentStatus) {
    const status =
      (
        {
          pending: 'pendiente',
          in_progress: 'en curso',
          completed: 'completada',
          expired: 'vencida',
          superseded: 'reemplazada',
        } as Record<string, string>
      )[assessmentStatus[1]] ?? 'actual'
    return `La revisión en estado «${status}» no se puede modificar.`
  }
  const questionNotInReview = message.match(/^Question (.+) is not part of this review$/)
  if (questionNotInReview)
    return 'Una pregunta ya no forma parte de esta revisión. Actualiza la página.'
  const missingAnswers = message.match(/^Every visible question must be answered: (.+)$/)
  if (missingAnswers) {
    return 'Responde todas las preguntas visibles para completar la revisión.'
  }

  return undefined
}

/**
 * Only explicitly translated server messages are allowed through to user-facing UI. Unknown
 * API/exception text falls back to the caller's Spanish copy so technical English never leaks.
 */
export function userFacingErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback

  const value = error as ErrorLike
  const code = typeof value.code === 'string' ? value.code : ''
  if (Object.hasOwn(MESSAGES_BY_CODE, code)) return MESSAGES_BY_CODE[code]

  const message = typeof value.message === 'string' ? value.message.trim() : ''
  if (!message) return fallback

  return (
    (Object.hasOwn(MESSAGES_BY_CODE, message) ? MESSAGES_BY_CODE[message] : undefined) ??
    translateKnownMessage(message) ??
    fallback
  )
}
