import type { ColumnDef } from '@tanstack/react-table'
import { Badge, Group, Tooltip } from '@mantine/core'
import type { Asset } from '@/app/types/payload-types'
import { TechnicalText } from '@/components/ui/TechnicalText'
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge'
import { ASSET_STATUS_LABEL, CRITICALITY_LABEL } from '@/lib/enum-labels'
import { RowActions } from './components/RowActions'

const STATUS_TONE: Record<string, StatusTone> = {
  active: 'success',
  offline: 'warning',
  retired: 'neutral',
}

// El input permite hasta 120 caracteres (modules/assets/schema.ts) — en la tabla se muestra la
// mitad: más que eso empuja el resto de columnas sin agregar información útil de un vistazo.
const ALIAS_TRUNCATE_AT = 50

function truncateChars(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
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
      accessorKey: 'alias',
      header: 'Alias',
      size: 200,
      // Los badges "New"/"Changed" viven DENTRO de la celda de Alias en vez de en su propia
      // columna — así cuando desaparecen (AssetDetailView marca first_viewed_at/limpia
      // technical_changed_at al entrar al detalle) el alias pasa a ocupar todo el ancho en vez de
      // dejar una columna vacía al lado. Mutuamente excluyentes: "Changed" solo aplica a un asset
      // ya visto (ingestScanReport.ts no lo marca si first_viewed_at es null), así que nunca se
      // muestran los dos juntos.
      cell: ({ row }) => {
        const alias = row.original.alias ?? ''
        const isOverflowing = alias.length > ALIAS_TRUNCATE_AT
        const label = <span>{truncateChars(alias, ALIAS_TRUNCATE_AT)}</span>
        return (
          <Group gap="xs" wrap="nowrap">
            {row.original.first_viewed_at == null ? (
              // flexShrink: 0 — sin esto el Group (flex row) encoge el badge junto con todo lo demás
              // cuando falta espacio, y Mantine trunca su label con ellipsis interno ("New" → "N..").
              <Badge size="sm" color="pine" variant="filled" style={{ flexShrink: 0 }}>
                New
              </Badge>
            ) : (
              row.original.technical_changed_at != null && (
                <Badge size="sm" color="orange" variant="filled" style={{ flexShrink: 0 }}>
                  Changed
                </Badge>
              )
            )}
            {isOverflowing ? <Tooltip label={alias}>{label}</Tooltip> : label}
          </Group>
        )
      },
    },
    {
      accessorKey: 'ip',
      header: 'IP',
      size: 140,
      cell: ({ row }) => row.original.ip && <TechnicalText>{row.original.ip}</TechnicalText>,
    },
    {
      accessorKey: 'hostname',
      header: 'Hostname',
      size: 220,
      cell: ({ row }) =>
        row.original.hostname && <TechnicalText truncate>{row.original.hostname}</TechnicalText>,
    },
    {
      accessorKey: 'criticality',
      header: 'Criticality',
      size: 140,
      cell: ({ row }) =>
        row.original.criticality ? CRITICALITY_LABEL[row.original.criticality] : '—',
    },
    showOffice
      ? {
          accessorKey: 'office',
          header: 'Office',
          size: 180,
          cell: ({ row }) => {
            const office = row.original.office
            return typeof office === 'object' && office ? office.name : '—'
          },
        }
      : {
          accessorKey: 'location',
          header: 'Location',
          size: 180,
          cell: ({ row }) => row.original.location || '—',
        },
    {
      accessorKey: 'status',
      header: 'Status',
      size: 120,
      meta: { align: 'center' },
      cell: ({ row }) => {
        const status = row.original.status ?? 'active'
        return (
          <StatusBadge
            tone={STATUS_TONE[status] ?? 'neutral'}
            label={ASSET_STATUS_LABEL[status] ?? status}
          />
        )
      },
    },
    {
      accessorKey: 'owner',
      header: 'Owner',
      cell: ({ row }) => {
        const owner = row.original.owner
        if (typeof owner === 'object' && owner) return owner.name
        return (owner && ownerNameById[owner]) || '—'
      },
    },
    {
      accessorKey: 'identified',
      header: 'Identified',
      size: 130,
      meta: { align: 'center' },
      cell: ({ row }) =>
        row.original.identified ? (
          <StatusBadge tone="success" label="Identified" />
        ) : (
          <StatusBadge tone="warning" label="Not identified" />
        ),
    },
    {
      id: 'actions',
      header: '',
      size: 84,
      cell: ({ row }) => <RowActions asset={row.original} />,
    },
  ]
}
