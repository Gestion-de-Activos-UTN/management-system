import type { RecalculationStatus } from '@/domain/risk/recalculation-status'

export function getRiskCalculationMessage(
  status: RecalculationStatus | undefined,
  hasEvaluation: boolean
) {
  if (status === 'pending' || status === 'processing') {
    return {
      color: 'pine',
      title: hasEvaluation ? 'Actualizando el puntaje' : 'Preparando el primer puntaje',
      message: hasEvaluation
        ? 'Los cambios están guardados. Mientras se actualiza el cálculo, se muestra la última evaluación completada.'
        : status === 'processing'
          ? 'El cálculo está en curso. El resultado aparecerá aquí cuando termine.'
          : 'El cálculo está en espera. El resultado aparecerá aquí cuando termine.',
    }
  }
  if (status === 'failed') {
    return {
      color: 'orange',
      title: hasEvaluation
        ? 'No se pudo actualizar el puntaje'
        : 'No se pudo calcular el primer puntaje',
      message: hasEvaluation
        ? 'Los cambios están guardados. Se muestra la última evaluación completada, que puede estar desactualizada.'
        : 'La información está guardada, pero el cálculo no pudo completarse. Todavía no hay un resultado para mostrar.',
    }
  }
  if (!hasEvaluation) {
    return {
      color: 'gray',
      title: 'Todavía no hay un puntaje',
      message:
        'Completa las revisiones de seguridad y registra la información de los equipos para generar la primera evaluación.',
    }
  }
  if (status === 'outdated') {
    return {
      color: 'orange',
      title: 'Evaluación pendiente de actualizar',
      message:
        'Se muestra la última evaluación completada. Puede no incluir los cambios más recientes.',
    }
  }
  return null
}
