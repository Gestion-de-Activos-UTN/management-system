'use client'
import { Alert, Button, Group, Stack, Text } from '@mantine/core'
import { formatDateTime } from '@/lib/format-date'
import { relationId } from '@/lib/relationId'
import { hasOrgWideScope } from '@/access/rbac/permissions'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'
import { useInventoryIncidents } from '../hooks/use-inventory-incidents'

export function InventoryIncidentsPanel({
  asOrganization,
  assetId,
}: {
  asOrganization?: string
  assetId?: string
}) {
  const { data, resolution } = useInventoryIncidents(asOrganization, assetId)
  const { data: ctx } = useTenantContext(asOrganization)
  if (!data?.length) return null
  const officeName = (value: unknown) =>
    value && typeof value === 'object' && 'name' in value
      ? String(value.name)
      : 'la oficina indicada'
  return (
    <Stack gap="sm">
      {data.map(incident => {
        const asset = incident.asset && typeof incident.asset === 'object' ? incident.asset : null
        const assetLabel = asset?.alias || asset?.hostname || asset?.ip || incident.ip
        const canResolve =
          ctx &&
          (ctx.role === 'org_admin' || ctx.role === 'office_manager') &&
          (hasOrgWideScope(ctx.role) ||
            [incident.office, incident.proposed_office]
              .filter(Boolean)
              .every(office => ctx.officeIds.includes(relationId(office))))
        return (
          <Alert
            key={incident.id}
            color="yellow"
            title={incident.kind === 'location' ? 'Ubicación por confirmar' : 'Equipo por revisar'}
          >
            <Stack gap="xs">
              {assetLabel && (
                <Text size="sm" fw={600}>
                  Equipo: {assetLabel}
                </Text>
              )}
              <Text size="sm">
                {incident.kind === 'location'
                  ? `Este equipo se detectó en ${officeName(incident.proposed_office)}. Conservamos su ubicación en ${officeName(incident.office)} hasta que un responsable confirme el traslado.`
                  : 'El escáner recibió datos contradictorios de un equipo. Esos datos no se aplicaron. Revisa el equipo y solicita una nueva exploración antes de marcarlo como revisado.'}
              </Text>
              <Text size="xs" c="dimmed">
                Última observación: {formatDateTime(incident.observed_at)}
              </Text>
              {canResolve ? (
                <Group gap="sm">
                  {incident.kind === 'location' ? (
                    <>
                      <Button
                        size="xs"
                        loading={resolution.isPending}
                        onClick={() => resolution.mutate({ id: incident.id, decision: 'move' })}
                      >
                        Confirmar traslado
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        disabled={resolution.isPending}
                        onClick={() => resolution.mutate({ id: incident.id, decision: 'keep' })}
                      >
                        Mantener ubicación
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="xs"
                      variant="light"
                      loading={resolution.isPending}
                      onClick={() => resolution.mutate({ id: incident.id, decision: 'reviewed' })}
                    >
                      Marcar como revisado
                    </Button>
                  )}
                </Group>
              ) : (
                <Text size="sm">
                  Un responsable con acceso a las oficinas involucradas debe resolver esta revisión.
                </Text>
              )}
              {resolution.isError && (
                <Text size="sm" c="red">
                  {(resolution.error as { message?: string }).message ??
                    'No se pudo guardar la decisión. Actualiza la vista e inténtalo nuevamente.'}
                </Text>
              )}
            </Stack>
          </Alert>
        )
      })}
    </Stack>
  )
}
