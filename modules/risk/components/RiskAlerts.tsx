import Link from 'next/link'
import { Alert, Button, List, Stack, Text } from '@mantine/core'
import { Info, Radar, WifiOff } from 'lucide-react'
import { controlTitle } from '../risk-labels'
import type { RiskEvaluationDTO } from '../service'

/**
 * Warnings beside the index (Plan §6, D21): important controls with too little information, offices
 * whose scanner is not reporting, and unidentified devices sharing a network with important ones.
 * They never change the index.
 */
export function RiskAlerts({
  evaluation,
  inventoryHref,
}: {
  evaluation: RiskEvaluationDTO
  inventoryHref: string
}) {
  const { context } = evaluation
  const warnings = evaluation.controls.filter(control => control.warning)
  const silentOffices = context.office_visibility.filter(item => item.reason_code !== 'agent_reporting')
  const label = (key: string) => context.labels[key] ?? key
  if (!warnings.length && !silentOffices.length && !context.shared_cidr.length) return null
  return (
    <Stack gap="md">
      {warnings.length > 0 && (
        <Alert color="yellow" title="Falta información en controles importantes" icon={<Info size={18} />}>
          <List size="sm" spacing={4}>
            {warnings.map(control => (
              <List.Item key={control.control_key}>
                <strong>{controlTitle(control.control_key)}</strong> ({control.control_key}): hay
                información para el {Math.round(control.coverage * 100)} % de lo que corresponde
                revisar. Faltan {control.pending_pairs} comprobaciones.
              </List.Item>
            ))}
          </List>
        </Alert>
      )}
      {silentOffices.length > 0 && (
        <Alert color="orange" title="Oficinas sin monitoreo activo" icon={<WifiOff size={18} />}>
          <List size="sm" spacing={4}>
            {silentOffices.map(item => (
              <List.Item key={item.office_id}>
                <strong>{label(`office:${item.office_id}`)}</strong>:{' '}
                {item.reason_code === 'agent_missing'
                  ? 'no tiene un escáner activo.'
                  : 'el escáner dejó de reportar.'}
              </List.Item>
            ))}
          </List>
        </Alert>
      )}
      {context.shared_cidr.length > 0 && (
        <Alert color="orange" title="Dispositivos sin identificar junto a equipos importantes" icon={<Radar size={18} />}>
          <Stack gap="sm" align="flex-start">
            <List size="sm" spacing={4}>
              {context.shared_cidr.map(group => (
                <List.Item key={`${group.office_id}|${group.cidr}`}>
                  {label(`office:${group.office_id}`)} · red {group.cidr}: {group.unidentified_assets}{' '}
                  sin identificar junto a {group.important_assets.map(label).join('; ')}.
                </List.Item>
              ))}
            </List>
            <Button component={Link} href={inventoryHref} size="sm" color="orange" w={{ base: '100%', xs: 'auto' }}>
              Identificar dispositivos
            </Button>
          </Stack>
        </Alert>
      )}
    </Stack>
  )
}
