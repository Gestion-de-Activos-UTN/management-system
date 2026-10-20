import Link from 'next/link'
import { Alert, Anchor, Button, List, Stack, Text } from '@mantine/core'
import { AlertTriangle, Radar } from 'lucide-react'
import { usePortalHref } from '@/lib/use-portal-href'
import { controlTitle } from '../risk.columns'
import type { RiskEvaluationDTO } from '../service'

/** Qualitative alerts (Reglas Globales §3 and §5.3). They never change the numeric score. */
export function RiskAlerts({
  alerts,
  inventoryHref,
}: {
  alerts: RiskEvaluationDTO['alerts']
  inventoryHref: string
}) {
  const href = usePortalHref()
  const exposure = alerts.undetermined_exposure
  const priority =
    alerts.critical_assets.length > 0 ||
    alerts.systemic_failures.length > 0 ||
    alerts.severe_concentration
  if (!priority && !exposure.length) return null
  return (
    <Stack gap="md">
      {priority && (
        <Alert color="red" title="Alertas prioritarias" icon={<AlertTriangle size={18} />}>
          <List size="sm" spacing={4}>
            {alerts.critical_assets.map(item => (
              <List.Item key={`${item.asset_id}:${item.control_key}`}>
                {item.asset_id.startsWith('asset:') ? (
                  <Anchor
                    component={Link}
                    href={href(`/portal/inventory/${item.asset_id.slice('asset:'.length)}`)}
                    fw={700}
                    size="sm"
                  >
                    {item.asset_label}
                  </Anchor>
                ) : (
                  <strong>{item.asset_label}</strong>
                )}{' '}
                es importante para la empresa y necesita mejorar su protección de{' '}
                {controlTitle(item.control_key).toLowerCase()} ({item.control_key}
                ).
              </List.Item>
            ))}
            {alerts.systemic_failures.map(key => (
              <List.Item key={key}>
                <strong>Problema repetido:</strong> {controlTitle(key)} ({key}) necesita mejoras en
                más de 1 de cada 5 casos revisados.
              </List.Item>
            ))}
            {alerts.severe_concentration && (
              <List.Item>
                La mayor parte del riesgo ({Math.round(alerts.severe_concentration_percentage)} %)
                se concentra en problemas importantes. Por eso el nivel de riesgo subió un nivel.
              </List.Item>
            )}
          </List>
        </Alert>
      )}
      {exposure.length > 0 && (
        <Alert color="orange" title="Exposición no determinada" icon={<Radar size={18} />}>
          <Stack gap="sm" align="flex-start">
            <Text size="sm">
              Hay dispositivos sin identificar en la misma red que estos equipos. Identifícalos para
              poder calcular su riesgo.
            </Text>
            {/* Punto y coma: los nombres ya usan " · " para separar oficina y equipo. */}
            <Text size="sm" fw={600}>
              {exposure.map(item => item.asset_label).join('; ')}.
            </Text>
            <Button
              component={Link}
              href={inventoryHref}
              size="sm"
              color="orange"
              w={{ base: '100%', xs: 'auto' }}
            >
              Identificar dispositivos
            </Button>
          </Stack>
        </Alert>
      )}
    </Stack>
  )
}
