'use client'

import { useState } from 'react'
import { Button, Divider, Group, Modal, SegmentedControl, Stack, Text } from '@mantine/core'
import { Download, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { Office } from '@/app/types/payload-types'
import type { AgentPlatform } from '@/domain/agents/buildAgentPackage'
import { useProvisionAgent } from '../hooks/use-offices'
import { useRevokeAgent } from '../hooks/use-offices'
import type { AgentQuotaSummary, OfficeAgentSummary } from '@/endpoints/officeAgentSummary'
import { AgentConnectivityBadge } from './AgentConnectivityBadge'

const PLATFORM_OPTIONS = [
  { label: 'Linux / macOS', value: 'posix' },
  { label: 'Windows', value: 'windows' },
]

// El paquete trae solo el launcher del SO elegido (domain/agents/buildAgentPackage.ts), así que
// el texto nombra el archivo que el usuario va a encontrar adentro y no uno genérico.
const PLATFORM_HINT: Record<AgentPlatform, string> = {
  posix:
    'El paquete contiene el código fuente de Python, las dependencias, el iniciador start-agent.sh y un archivo de configuración generado automáticamente.',
  windows:
    'El paquete contiene el código fuente de Python, las dependencias, los iniciadores start-agent.cmd y start-agent.ps1 y un archivo de configuración generado automáticamente.',
}

function downloadBlob(blob: Blob, officeName: string, platform: AgentPlatform) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `siam-agent-${officeName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${platform}.zip`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function AgentProvisionModal({
  office,
  opened,
  onClose,
  summary,
  quota,
}: {
  office: Office | null
  opened: boolean
  onClose: () => void
  summary?: OfficeAgentSummary
  quota: AgentQuotaSummary | null
}) {
  const provision = useProvisionAgent()
  const revoke = useRevokeAgent()
  const [platform, setPlatform] = useState<AgentPlatform>('posix')
  const [agentToDeactivate, setAgentToDeactivate] = useState<string | null>(null)
  // quota.available ya viene resuelto server-side como min(cupo de organización, cupo de esta
  // oficina) — ver domain/subscriptions/agent-quota.ts::getAgentQuota. Recalcular acá solo la
  // mitad "por oficina" podía habilitar el botón con el cupo de organización ya agotado.
  const officeSlotsAvailable = quota?.available

  function handleClose() {
    setPlatform('posix')
    setAgentToDeactivate(null)
    onClose()
  }

  function handleProvision() {
    if (!office) return
    provision.mutate(
      { officeId: String(office.id), platform },
      {
        onSuccess: blob => {
          downloadBlob(blob, office.name, platform)
          handleClose()
        },
      }
    )
  }

  function confirmDeactivation() {
    if (!agentToDeactivate) return
    revoke.mutate(agentToDeactivate, {
      onSuccess: () => setAgentToDeactivate(null),
    })
  }

  const hasAgents = (summary?.total ?? 0) > 0

  return (
    <>
      <Modal
        opened={opened}
        onClose={handleClose}
        title={hasAgents ? 'Administrar escáneres' : 'Instalar escáner'}
        centered
        size="md"
      >
        <Stack gap="md">
          <Group gap="sm" align="flex-start" wrap="nowrap">
            <ShieldCheck size={22} strokeWidth={1.5} />
            <Stack gap={4} style={{ minWidth: 0 }}>
              <Text fw={600}>{office?.name}</Text>
              <Text size="sm" c="dimmed">
                Se descargará para esta oficina una nueva credencial de agente y un paquete listo
                para ejecutar.
              </Text>
            </Stack>
          </Group>
          {hasAgents && (
            <Stack gap="xs">
              <Text size="sm" fw={600}>
                Escáneres existentes
              </Text>
              {summary?.agents.map(agent => (
                <Group key={agent.id} justify="space-between" gap="sm">
                  <Stack gap={2} style={{ minWidth: 0 }}>
                    <Text size="sm" truncate>
                      {agent.id}
                    </Text>
                    <AgentConnectivityBadge
                      connectivity={agent.connectivity}
                      revocationReason={agent.revocation_reason}
                    />
                  </Stack>
                  {agent.lifecycle_status !== 'revoked' && (
                    <Button
                      size="xs"
                      color="red"
                      variant="light"
                      loading={revoke.isPending}
                      onClick={() => setAgentToDeactivate(agent.id)}
                    >
                      Desactivar
                    </Button>
                  )}
                </Group>
              ))}
            </Stack>
          )}
          {hasAgents && <Divider label="Agregar otro escáner" labelPosition="left" />}
          <Stack gap={6}>
            <Text size="sm" fw={500}>
              Sistema operativo
            </Text>
            <SegmentedControl
              fullWidth
              data={PLATFORM_OPTIONS}
              value={platform}
              onChange={value => setPlatform(value as AgentPlatform)}
              disabled={provision.isPending}
            />
          </Stack>
          <Text size="sm" c="dimmed">
            {PLATFORM_HINT[platform]}
          </Text>
          {quota && (
            <Stack gap={2}>
              <Text size="sm" fw={500}>
                Cupos de escáner: {quota.used} of {quota.limit} en uso
              </Text>
              {quota.per_office !== null && (
                <Text size="xs" c="dimmed">
                  Esta oficina: {summary?.active ?? 0} of {quota.per_office} en uso
                </Text>
              )}
            </Stack>
          )}
          <Group justify="flex-end" wrap="wrap">
            <Button variant="default" onClick={handleClose} disabled={provision.isPending}>
              Cancelar
            </Button>
            <Button
              leftSection={<Download size={16} strokeWidth={1.5} />}
              loading={provision.isPending}
              disabled={officeSlotsAvailable === 0}
              onClick={handleProvision}
            >
              Generar y descargar
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={agentToDeactivate !== null}
        onClose={() => !revoke.isPending && setAgentToDeactivate(null)}
        title="Desactivar escáner"
        centered
        size="sm"
        closeOnClickOutside={!revoke.isPending}
        closeOnEscape={!revoke.isPending}
        withCloseButton={!revoke.isPending}
      >
        <Stack gap="lg">
          <Group align="flex-start" wrap="nowrap">
            <ShieldAlert size={24} color="var(--mantine-color-red-6)" strokeWidth={1.5} />
            <Stack gap={4}>
              <Text fw={600}>Esta acción es permanente</Text>
              <Text size="sm" c="dimmed">
                La credencial del escáner dejará de funcionar de inmediato. Para volver a conectar
                esta oficina, deberás instalar un nuevo escáner.
              </Text>
              <Text size="xs" c="dimmed">
                Escáner: {agentToDeactivate}
              </Text>
            </Stack>
          </Group>
          <Group justify="flex-end">
            <Button
              variant="default"
              disabled={revoke.isPending}
              onClick={() => setAgentToDeactivate(null)}
            >
              Cancelar
            </Button>
            <Button color="red" loading={revoke.isPending} onClick={confirmDeactivation}>
              Desactivar escáner
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
