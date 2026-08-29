import type { ColumnDef } from '@tanstack/react-table'
import { Badge, Group, Text, Tooltip } from '@mantine/core'
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

// Texto de negocio (no técnico/identificador) truncado por ancho de columna con el mismo
// mecanismo visual que TechnicalText.truncate, pero sin forzar monoespaciado — un alias/location
// escrito por un humano no es un hostname.
function TruncatedText({ children }: { children: string }) {
  return (
    <Tooltip label={children}>
      <Text
        size="sm"
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
          maxWidth: '100%',
        }}
      >
        {children}
      </Text>
    </Tooltip>
  )
}

// Users.read is () => false by design (see modules/users/service.ts) — a plain `depth=1` list
// request can't populate `owner` past its raw id (Payload's own access check on the related
// collection blocks it, falling back to the id string). Resolve the display name from the
// already-fetched org-members list instead of depending on relationship population.
export function getAssetsColumns(
  ownerNameById: Record<string, string>
): ColumnDef<Asset, unknown>[] {
  return [
    {
      accessorKey: 'alias',
      header: 'Alias',
      size: 200,
      // El badge "New" vive DENTRO de la celda de Alias en vez de en su propia columna — así
      // cuando desaparece (AssetDetailView marca first_viewed_at al entrar al detalle; un re-scan
      // de ingesta jamás toca ese campo) el alias pasa a ocupar todo el ancho en vez de dejar una
      // columna vacía al lado.
      cell: ({ row }) => {
        const alias = row.original.alias ?? ''
        const isOverflowing = alias.length > ALIAS_TRUNCATE_AT
        const label = <span>{truncateChars(alias, ALIAS_TRUNCATE_AT)}</span>
        return (
          <Group gap="xs" wrap="nowrap">
            {row.original.first_viewed_at == null && (
              // flexShrink: 0 — sin esto el Group (flex row) encoge el badge junto con todo lo demás
              // cuando falta espacio, y Mantine trunca su label con ellipsis interno ("New" → "N..").
              <Badge size="sm" color="pine" variant="filled" style={{ flexShrink: 0 }}>
                New
              </Badge>
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
    {
      accessorKey: 'location',
      header: 'Location',
      size: 180,
      cell: ({ row }) =>
        row.original.location && <TruncatedText>{row.original.location}</TruncatedText>,
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
