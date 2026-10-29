import { expect, it } from 'vitest'
import { getRiskCalculationMessage } from './risk-calculation-message'

it.each(['pending', 'processing'] as const)(
  'does not invent a previous evaluation when the first calculation is %s',
  status => {
    const notice = getRiskCalculationMessage(status, false)
    expect(notice?.title).toBe('Preparando el primer puntaje')
    expect(notice?.message).not.toMatch(/anterior|última evaluación/)
    expect(getRiskCalculationMessage(status, true)?.message).toContain(
      'última evaluación completada'
    )
  }
)

it('distinguishes no evaluation from a failed initial calculation', () => {
  expect(getRiskCalculationMessage('outdated', false)?.title).toBe('Todavía no hay un puntaje')
  expect(getRiskCalculationMessage('outdated', false)?.message).not.toContain('en espera')
  expect(getRiskCalculationMessage('failed', false)?.title).toBe(
    'No se pudo calcular el primer puntaje'
  )
  expect(getRiskCalculationMessage('failed', true)?.message).toContain('desactualizada')
})

it('keeps a completed current evaluation free of recalculation warnings', () => {
  expect(getRiskCalculationMessage('current', true)).toBeNull()
  expect(getRiskCalculationMessage(undefined, true)).toBeNull()
  expect(getRiskCalculationMessage('outdated', true)?.title).toBe(
    'Evaluación pendiente de actualizar'
  )
})
