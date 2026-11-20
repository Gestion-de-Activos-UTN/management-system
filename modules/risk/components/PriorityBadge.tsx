import { Badge, type BadgeProps } from '@mantine/core'
import type { Priority } from '@/domain/risk/priority'
import { PRIORITY_COLOR, PRIORITY_LABEL } from '../risk-labels'

/**
 * Única forma de mostrar la prioridad de una deficiencia. Como RiskBandBadge, usa Badge y no
 * StatusBadge: los 4 niveles necesitan 4 colores (naranja para "alta"). El texto siempre va.
 */
export function PriorityBadge({
  priority,
  ...props
}: { priority: Priority } & Omit<BadgeProps, 'color'>) {
  return (
    <Badge color={PRIORITY_COLOR[priority]} {...props}>
      {PRIORITY_LABEL[priority]}
    </Badge>
  )
}
