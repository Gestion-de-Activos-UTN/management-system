import { test } from 'node:test'
import assert from 'node:assert/strict'
import { taskActivity } from './task-activity'

test('taskActivity junta eventos de la tarea, sus reclamos y liberaciones y los del activo, del más reciente al más antiguo', () => {
  const events = taskActivity({
    createdAt: '2026-10-10T16:00:00.000Z',
    completed_at: null,
    completion_reason: null,
    cancelled_at: '2026-10-14T10:00:00.000Z',
    cancellation_reason: 'Equipo dado de baja',
    archived_at: null,
    actor_labels: {
      created_by: 'Marcos',
      claimed_by: 'Lucía',
      completed_by: null,
      cancelled_by: 'Lucía',
      archived_by: null,
      claim_events: [
        { action: 'claimed', at: '2026-10-11T09:00:00.000Z', actor: 'Ana' },
        { action: 'released', at: '2026-10-11T12:00:00.000Z', actor: 'Ana' },
        { action: 'claimed', at: '2026-10-12T09:00:00.000Z', actor: 'Lucía' },
      ],
    },
    lifecycle_history: [{ reason: 'La IP cambió', at: '2026-10-13T02:40:00.000Z' }],
  })
  assert.deepEqual(
    events.map(event => event.label),
    ['Cancelada', 'La IP cambió', 'Reclamada', 'Liberada', 'Reclamada', 'Creada']
  )
  assert.equal(events[3].actor, 'Ana')
  assert.equal(events[0].note, 'Motivo: Equipo dado de baja')
  assert.equal(events[0].tone, 'danger')
  assert.equal(events[1].tone, undefined)
})
