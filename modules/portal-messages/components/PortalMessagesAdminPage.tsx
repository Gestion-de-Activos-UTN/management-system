'use client'

import { useState } from 'react'
import { Alert, Button, Modal, Stack, Switch, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { Plus } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/ui/DataTable'
import { DateTimeCell } from '@/components/ui/DateTimeCell'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate } from '@/lib/format-date'
import { roleSlugLabel } from '@/lib/role-labels'
import { useAdminPortalMessages, useSetPortalMessageActive } from '../hooks/use-portal-messages'
import type { PortalMessageInput } from '../schema'
import type { PortalMessageDTO, PortalMessageRecord } from '../service'
import {
  PORTAL_MESSAGE_SECTION_LINKS,
  PORTAL_MESSAGE_STATUS_LABELS,
  PORTAL_MESSAGE_STATUS_TONES,
  PORTAL_MESSAGE_TYPE_LABELS,
  PORTAL_MESSAGE_TYPE_TONES,
  portalMessageStatus,
} from '../portal-message-labels'
import { PortalMessageForm } from './PortalMessageForm'
import { RowActions } from './RowActions'
import { PortalMessageDialog } from './PortalMessageDialog'

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

function audienceSummary(
  audience: PortalMessageRecord['audience'],
  organizationName: (id: string) => string | undefined
) {
  if (audience.scope === 'global')
    return { primary: 'Global', secondary: 'Todas las organizaciones' }
  const ids = audience.organization_ids
  const names = ids.map(organizationName).filter(Boolean)
  const primary =
    ids.length <= 2 && names.length === ids.length
      ? names.join(', ')
      : plural(ids.length, 'organización', 'organizaciones')
  const secondary =
    audience.target_kind === 'role'
      ? audience.role_slugs.map(roleSlugLabel).join(', ')
      : audience.target_kind === 'user'
        ? plural(audience.user_ids.length, 'persona', 'personas')
        : 'Todas las personas'
  return { primary, secondary }
}

/** Lo que vería quien recibe el mensaje, a partir del registro guardado. */
function previewFromRecord(message: PortalMessageRecord): PortalMessageDTO['entity'] {
  if (message.linked_entity) {
    return {
      kind: 'entity',
      relationTo: message.linked_entity.relationTo,
      label: message.linked_entity_label ?? undefined,
      access: message.linked_entity_label ? 'allowed' : 'unavailable',
    }
  }
  if (!message.linked_section) return null
  return {
    kind: 'section',
    relationTo: message.linked_section,
    label: PORTAL_MESSAGE_SECTION_LINKS[message.linked_section].label,
    access: 'allowed',
  }
}

export function PortalMessagesAdminPage() {
  const [opened, { open, close }] = useDisclosure(false)
  const [editing, setEditing] = useState<PortalMessageRecord | null>(null)
  const [previewing, setPreviewing] = useState<PortalMessageRecord | null>(null)
  const query = useAdminPortalMessages([])
  const setActive = useSetPortalMessageActive()
  const organizations = new Map(
    (query.data?.organizations ?? []).map(organization => [organization.id, organization.name])
  )

  const startNew = () => {
    setEditing(null)
    open()
  }
  const startEdit = (message: PortalMessageRecord) => {
    setEditing(message)
    open()
  }
  const toggleActive = (message: PortalMessageRecord) => {
    const input: PortalMessageInput = { ...message, is_active: !message.is_active }
    setActive.mutate({ input, id: message.id })
  }

  const columns: ColumnDef<PortalMessageRecord, unknown>[] = [
    {
      accessorKey: 'title',
      header: 'Título',
      cell: ({ row }) => (
        <Stack gap={2}>
          <Text fw={600} size="sm" lineClamp={1}>
            {row.original.title}
          </Text>
          <Text c="dimmed" size="xs" lineClamp={1}>
            {row.original.description}
          </Text>
        </Stack>
      ),
    },
    {
      accessorKey: 'message_type',
      header: 'Tipo',
      cell: ({ row }) => (
        <StatusBadge
          tone={PORTAL_MESSAGE_TYPE_TONES[row.original.message_type]}
          label={PORTAL_MESSAGE_TYPE_LABELS[row.original.message_type]}
        />
      ),
    },
    {
      id: 'audience',
      header: 'Audiencia',
      cell: ({ row }) => {
        const summary = audienceSummary(row.original.audience, id => organizations.get(id))
        return (
          <Stack gap={0}>
            <Text size="sm" lineClamp={1}>
              {summary.primary}
            </Text>
            <Text size="xs" c="dimmed" lineClamp={1}>
              {summary.secondary}
            </Text>
          </Stack>
        )
      },
    },
    {
      id: 'status',
      header: 'Estado',
      cell: ({ row }) => {
        const status = portalMessageStatus(row.original)
        return (
          <StatusBadge
            tone={PORTAL_MESSAGE_STATUS_TONES[status]}
            label={PORTAL_MESSAGE_STATUS_LABELS[status]}
          />
        )
      },
    },
    {
      accessorKey: 'is_active',
      header: 'Activo',
      cell: ({ row }) => (
        <Switch
          aria-label={`${row.original.is_active ? 'Desactivar' : 'Activar'} ${row.original.title}`}
          checked={row.original.is_active}
          disabled={setActive.isPending && setActive.variables?.id === row.original.id}
          onChange={() => toggleActive(row.original)}
        />
      ),
    },
    {
      accessorKey: 'expires_at',
      header: 'Expira',
      cell: ({ getValue }) => {
        const value = getValue<string | null | undefined>()
        return (
          <Text size="sm" c={value ? undefined : 'dimmed'}>
            {value ? formatDate(value) : 'Sin fecha'}
          </Text>
        )
      },
    },
    {
      accessorKey: 'createdAt',
      header: 'Creado',
      cell: ({ getValue }) => <DateTimeCell value={getValue<string | undefined>()} />,
    },
    {
      id: 'actions',
      header: 'Acciones',
      enableSorting: false,
      meta: { align: 'center' },
      cell: ({ row }) => (
        <RowActions message={row.original} onPreview={setPreviewing} onEdit={startEdit} />
      ),
    },
  ]

  const closePreview = () => setPreviewing(null)

  return (
    <Stack gap="lg">
      <PageHeader
        title="Mensajes del portal"
        description="Crea avisos y acciones dirigidos a organizaciones y sus usuarios."
        rightSection={
          <Button leftSection={<Plus size={16} strokeWidth={1.5} />} onClick={startNew}>
            Nuevo mensaje
          </Button>
        }
      />
      {query.isError && <Alert color="red">No se pudieron cargar los mensajes.</Alert>}
      <DataTable
        columns={columns}
        data={query.data?.docs ?? []}
        isLoading={query.isPending}
        emptyLabel="Todavía no hay mensajes."
        minWidth={1000}
      />
      <Modal
        opened={opened}
        onClose={close}
        title={editing ? 'Editar mensaje' : 'Nuevo mensaje'}
        size="xl"
        centered
      >
        <PortalMessageForm
          key={editing?.id ?? 'new'}
          message={editing}
          onSaved={() => {
            close()
            setEditing(null)
          }}
        />
      </Modal>
      {/* Vista previa: el mismo modal que verá quien lo recibe; cualquier botón sólo lo cierra. */}
      <PortalMessageDialog
        message={previewing && { ...previewing, entity: previewFromRecord(previewing) }}
        opened={Boolean(previewing)}
        onClose={closePreview}
        onAcknowledge={closePreview}
        onRemindLater={closePreview}
        onNoThanks={closePreview}
        onAction={closePreview}
      />
    </Stack>
  )
}
