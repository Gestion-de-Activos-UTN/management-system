import type { ColumnDef } from '@tanstack/react-table'
import { Badge, Group, Stack, Text, Tooltip } from '@mantine/core'
import type { Asset } from '@/app/types/payload-types'
import { TechnicalText } from '@/components/ui/TechnicalText'
import { OneLineText } from '@/components/ui/OneLineText'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ASSET_STATUS_LABEL, CRITICALITY_LABEL } from '@/lib/enum-labels'
import { RowActions } from './components/RowActions'

// Sólo los estados no activos se muestran (badge en la celda "Equipo").
const STATUS_COLOR: Record<string, string> = {
  offline: 'yellow',
  retired: 'gray',
}

// El alias sólo cuenta una vez confirmada la identificación; antes, hostname y luego IP.
function deviceName(asset: Asset): string | null {
  const alias = asset.identification_status === 'confirmed' ? asset.alias : null
  return alias || asset.hostname || asset.ip || null
}

// Users.read is () => false by design (see modules/users/service.ts) — a plain `depth=1` list
// request can't populate `owner` past its raw id (Payload's own access check on the related
// collection blocks it, falling back to the id string). Resolve the display name from the
// already-fetched org-members list instead of depending on relationship population.
export function getAssetsColumns(
  ownerNameById: Record<string, string>,
  showOffice: boolean
): ColumnDef<Asset, unknown>[] {
  return [
    {
      id: 'device',
      header: 'Equipo',
      size: 260,
      // Alias, IP y hostname en una sola celda: se leen como una unidad y liberan dos columnas.
      // Ordena por el mismo texto que muestra la primera línea.
      accessorFn: asset => deviceName(asset) ?? '',
      // Los badges "Nuevo"/"Modificado" viven DENTRO de esta celda en vez de en su propia
      // columna — así cuando desaparecen (AssetDetailView marca first_viewed_at/limpia
      // technical_changed_at al entrar al detalle) el nombre ocupa todo el ancho en vez de
      // dejar una columna vacía al lado. Mutuamente excluyentes: "Modificado" solo aplica a un
      // asset ya visto (ingestScanReport.ts no lo marca si first_viewed_at es null).
      cell: ({ row }) => {
        const asset = row.original
        const name = deviceName(asset)
        const status = asset.status ?? 'active'
        // Lo que ya es el nombre principal no se repite en la línea técnica.
        const technical = [asset.ip, asset.hostname]
          .filter(value => value && value !== name)
          .join(' · ')
        return (
          <Stack gap={2} miw={0}>
            <Group gap="xs" wrap="nowrap" miw={0}>
              {asset.first_viewed_at == null ? (
                // flexShrink: 0 — sin esto el Group encoge el badge y Mantine trunca su label.
                <Badge size="sm" color="pine" variant="filled" style={{ flexShrink: 0 }}>
                  Nuevo
                </Badge>
              ) : (
                asset.technical_changed_at != null && (
                  <Badge size="sm" color="orange" variant="filled" style={{ flexShrink: 0 }}>
                    Modificado
                  </Badge>
                )
              )}
              <Tooltip label={name} disabled={!name} openDelay={400}>
                <Text
                  size="sm"
                  fw={600}
                  truncate
                  c={name ? undefined : 'dimmed'}
                  ff={name && name !== asset.alias ? 'monospace' : undefined}
                >
                  {name ?? 'Sin nombre'}
                </Text>
              </Tooltip>
              {/* La tabla de activos sólo agrupa activos al cargar (useFrozenBucket): una fila
                  que cambió de estado después, y la tabla de retirados, lo indican acá. */}
              {status !== 'active' && (
                <Badge
                  size="sm"
                  color={STATUS_COLOR[status] ?? 'gray'}
                  variant="light"
                  style={{ flexShrink: 0 }}
                >
                  {ASSET_STATUS_LABEL[status] ?? status}
                </Badge>
              )}
              {asset.assessment_scope === 'excluded' && (
                <Badge size="sm" color="gray" variant="light" style={{ flexShrink: 0 }}>
                  Fuera de alcance
                </Badge>
              )}
            </Group>
            {technical && (
              <TechnicalText size="xs" c="dimmed" truncate>
                {technical}
              </TechnicalText>
            )}
          </Stack>
        )
      },
    },
    {
      accessorKey: 'criticality',
      header: 'Criticidad',
      size: 140,
      cell: ({ row }) =>
        row.original.identification_status === 'confirmed' && row.original.criticality
          ? CRITICALITY_LABEL[row.original.criticality]
          : '—',
    },
    showOffice
      ? {
          accessorKey: 'office',
          header: 'Oficina',
          size: 180,
          cell: ({ row }) => {
            const office = row.original.office
            return (
              <OneLineText>{typeof office === 'object' && office ? office.name : null}</OneLineText>
            )
          },
        }
      : {
          accessorKey: 'location',
          header: 'Ubicación',
          size: 180,
          cell: ({ row }) => (
            <OneLineText>
              {row.original.identification_status === 'confirmed' ? row.original.location : null}
            </OneLineText>
          ),
        },
    {
      accessorKey: 'owner',
      header: 'Responsable',
      cell: ({ row }) => {
        if (row.original.identification_status !== 'confirmed')
          return <OneLineText>{null}</OneLineText>
        const owner = row.original.owner
        if (typeof owner === 'object' && owner) return <OneLineText>{owner.name}</OneLineText>
        return <OneLineText>{owner ? ownerNameById[owner] : null}</OneLineText>
      },
    },
    {
      accessorKey: 'identification_status',
      header: 'Identificación',
      size: 160,
      meta: { align: 'center' },
      cell: ({ row }) =>
        row.original.identification_status === 'confirmed' ? (
          <StatusBadge tone="success" label="Identificado" />
        ) : row.original.identification_status === 'needs_review' ? (
          <StatusBadge tone="warning" label="A revisar" />
        ) : (
          <StatusBadge tone="warning" label="No identificado" />
        ),
    },
    {
      id: 'actions',
      header: 'Acciones',
      size: 100,
      meta: { align: 'center' },
      cell: ({ row }) => <RowActions asset={row.original} />,
    },
  ]
}
