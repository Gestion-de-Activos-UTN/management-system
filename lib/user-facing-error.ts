type ErrorLike = {
  code?: unknown
  message?: unknown
}

const MESSAGES_BY_CODE: Record<string, string> = {
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
    message.startsWith('El responsable es obligatorio.') ||
    message.startsWith('Elegí un responsable para la nueva oficina.') ||
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
    return `La pregunta ${questionUnavailable[1]} (versión ${questionUnavailable[2]}) ya no está disponible.`
  }
  const questionPolicy = message.match(/^Question (.+) is not available for this policy$/)
  if (questionPolicy)
    return `La pregunta ${questionPolicy[1]} no está disponible para esta política.`
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
    return `La pregunta ${questionNotInReview[1]} no forma parte de esta revisión.`
  const missingAnswers = message.match(/^Every visible question must be answered: (.+)$/)
  if (missingAnswers) {
    return `Responde todas las preguntas visibles para completar la revisión: ${missingAnswers[1]}.`
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
  if (MESSAGES_BY_CODE[code]) return MESSAGES_BY_CODE[code]

  const message = typeof value.message === 'string' ? value.message.trim() : ''
  if (!message) return fallback

  return MESSAGES_BY_CODE[message] ?? translateKnownMessage(message) ?? fallback
}
