import { Badge, type BadgeProps } from '@mantine/core'
import { RISK_BAND_LABEL } from '@/lib/enum-labels'
import { RISK_BAND_COLOR } from '../risk-labels'

/**
 * Única forma de mostrar un nivel de riesgo. Usa Badge con RISK_BAND_COLOR y no StatusBadge:
 * los 4 niveles necesitan 4 colores (incluido naranja para "alto") y StatusBadge sólo tiene 5
 * tonos genéricos — mapear ahí hacía que "Alto" saliera amarillo en una tarjeta y naranja en otra.
 */
export function RiskBandBadge({ band, ...props }: { band: string } & Omit<BadgeProps, 'color'>) {
  return (
    <Badge color={RISK_BAND_COLOR[band] ?? 'gray'} {...props}>
      {RISK_BAND_LABEL[band] ?? band}
    </Badge>
  )
}
