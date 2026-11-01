import { expect, it } from 'vitest'
import { userFacingErrorMessage } from './user-facing-error'

it.each([
  ['already_claimed', 'Otra persona ya reclamó esta tarea. Actualiza la lista.'],
  [
    'task_completed_by_admin',
    'La tarea ya fue completada por un administrador. Revisa su actividad.',
  ],
  ['task_already_completed', 'La tarea ya fue completada. Revisa su actividad.'],
  ['task_cancelled', 'La tarea fue cancelada y ya no se puede completar ni liberar.'],
  ['task_state_changed', 'La tarea ya no está en curso. Revisa su estado actualizado.'],
  ['task_cannot_be_deleted', 'Solo puedes eliminar tareas pendientes que nunca fueron reclamadas.'],
  ['task_not_terminal', 'Solo puedes archivar tareas completadas o canceladas.'],
  ['office_limit_reached', 'Alcanzaste el límite de oficinas activas de tu plan.'],
  ['agent_limit_reached', 'Alcanzaste el límite de escáneres de tu plan.'],
  ['office_not_available', 'La oficina no está disponible o está inactiva.'],
  [
    'organization_inactive',
    'La organización está inactiva. Pide su reactivación al administrador de la plataforma.',
  ],
  ['bulk_selection_stale', 'La selección cambió. Vuelve a revisar los activos incluidos.'],
  ['review_not_due_yet', 'Todavía no corresponde realizar una nueva revisión de este activo.'],
  ['no_eligible_assignees', 'No hay personas con acceso para realizar esta tarea.'],
])(
  'explains the actual rejection for %s even when the server message is technical',
  (code, expected) => {
    expect(userFacingErrorMessage({ code, message: 'internal key' }, 'No se pudo guardar')).toBe(
      expected
    )
  }
)

it.each([
  'La pregunta endpoint_firewall (versión 2) ya no está disponible.',
  'La pregunta endpoint_firewall no está disponible para esta política.',
  'La pregunta endpoint_firewall no forma parte de esta revisión.',
  'Question endpoint_firewall v2 is unavailable',
  'Question endpoint_firewall is not available for this policy',
  'Question endpoint_firewall is not part of this review',
  'La respuesta elegida ya no está disponible para la pregunta endpoint_firewall.',
  'Responde todas las preguntas visibles para completar la revisión: endpoint_firewall, disk_encryption.',
  'Every visible question must be answered: endpoint_firewall, disk_encryption',
])('explains changed or missing questions without showing internal keys: %s', message => {
  const result = userFacingErrorMessage({ message }, 'No se pudo completar la revisión')
  expect(result).not.toMatch(/endpoint_firewall|disk_encryption|versión/)
  expect(result).toMatch(/pregunta|respuesta/i)
  expect(result).not.toBe('No se pudo completar la revisión')
})

it('uses the safe fallback for unknown errors, including inherited property names', () => {
  expect(
    userFacingErrorMessage({ code: 'constructor', message: '__proto__' }, 'No se pudo guardar')
  ).toBe('No se pudo guardar')
})
