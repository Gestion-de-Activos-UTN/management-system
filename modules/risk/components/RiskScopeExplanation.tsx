import { Text } from '@mantine/core'
import type { RiskScope } from '../service'

export function RiskScopeExplanation({ scope }: { scope?: RiskScope }) {
  if (!scope || scope === 'office') return null
  return (
    <Text size="sm" c="dimmed">
      {scope === 'organization'
        ? 'Evaluación conjunta de la organización, calculada con sus activos y controles. No es un promedio de los puntajes de las oficinas.'
        : 'Evaluación conjunta de tus oficinas asignadas, calculada con sus activos y controles. No es un promedio de sus puntajes.'}
    </Text>
  )
}
