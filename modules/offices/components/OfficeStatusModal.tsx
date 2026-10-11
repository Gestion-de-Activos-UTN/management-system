'use client'

import { Alert, Button, Group, List, Loader, Modal, Stack, Text } from '@mantine/core'
import { Power, PowerOff, RadioTower, UserX } from 'lucide-react'
import type { Office } from '@/app/types/payload-types'
import { roleSlugLabel } from '@/lib/role-labels'
import { useOfficeDeactivationImpact, useSetOfficeActive } from '../hooks/use-offices'

/**
 * Confirmación para desactivar o reactivar una oficina. Al desactivar muestra antes el impacto
 * real (escáneres que se revocan y personas que se desactivan por quedarse sin oficina); la
 * confirmación es el aviso previo que pide el endpoint para desactivar a esas personas.
 */
export function OfficeStatusModal({
  office,
  onClose,
  asOrganization,
}: {
  office: Office | null
  onClose: () => void
  asOrganization?: string
}) {
  const deactivating = office?.is_active !== false
  const impact = useOfficeDeactivationImpact(
    office && deactivating ? String(office.id) : null,
    asOrganization
  )
  const setActive = useSetOfficeActive(asOrganization)
  const members = impact.data?.members_without_office ?? []
  const agents = impact.data?.agents ?? 0

  const confirm = () => {
    if (!office) return
    setActive.mutate(
      {
        id: String(office.id),
        isActive: !deactivating,
        confirmMemberDeactivation: members.length > 0,
      },
      // Si mientras tanto cambió a quiénes afecta, el servidor lo rechaza: se recarga el aviso.
      { onSuccess: onClose, onError: () => void impact.refetch() }
    )
  }

  return (
    <Modal
      opened={Boolean(office)}
      onClose={onClose}
      title={deactivating ? 'Desactivar oficina' : 'Reactivar oficina'}
      centered
    >
      {office && (
        <Stack gap="md">
          {deactivating ? (
            impact.isPending ? (
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="sm" c="dimmed">
                  Revisando a quiénes afecta…
                </Text>
              </Group>
            ) : (
              <>
                <Text size="sm">
                  <strong>{office.name}</strong> dejará de estar disponible para elegirse. Su
                  inventario, escaneos, tareas e historial de riesgo se conservan.
                </Text>
                {agents > 0 && (
                  <Alert color="yellow" icon={<RadioTower size={16} strokeWidth={1.5} />}>
                    Se {agents === 1 ? 'revocará 1 escáner' : `revocarán ${agents} escáneres`} de
                    esta oficina: dejarán de enviar datos y no se pueden volver a usar.
                  </Alert>
                )}
                {members.length > 0 && (
                  <Alert
                    color="red"
                    icon={<UserX size={16} strokeWidth={1.5} />}
                    title={
                      members.length === 1
                        ? 'Esta persona se va a desactivar'
                        : `Estas ${members.length} personas se van a desactivar`
                    }
                  >
                    <Stack gap="xs">
                      <Text size="sm">
                        {members.length === 1 ? 'Queda' : 'Quedan'} sin ninguna oficina asignada.
                        Para evitarlo, asígnales otra oficina desde Usuarios antes de continuar.
                      </Text>
                      <List size="sm" spacing={2}>
                        {members.map(member => (
                          <List.Item key={member.user_id}>
                            {member.name || member.email} · {roleSlugLabel(member.role)}
                          </List.Item>
                        ))}
                      </List>
                    </Stack>
                  </Alert>
                )}
              </>
            )
          ) : (
            <Text size="sm">
              <strong>{office.name}</strong> vuelve a estar disponible. Los escáneres revocados y
              las personas que se desactivaron con ella <strong>no</strong> se reactivan: hay que
              instalar un escáner nuevo y reactivar a cada persona desde Usuarios.
            </Text>
          )}
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              color={deactivating ? 'red' : undefined}
              disabled={deactivating && impact.isPending}
              loading={setActive.isPending}
              leftSection={
                deactivating ? (
                  <PowerOff size={16} strokeWidth={1.5} />
                ) : (
                  <Power size={16} strokeWidth={1.5} />
                )
              }
              onClick={confirm}
            >
              {!deactivating
                ? 'Reactivar oficina'
                : members.length
                  ? `Desactivar oficina y ${members.length === 1 ? 'persona' : `${members.length} personas`}`
                  : 'Desactivar oficina'}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  )
}
