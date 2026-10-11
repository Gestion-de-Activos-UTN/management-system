'use client'

import { useState } from 'react'
import { Badge, Button, Group, Modal, Stack, Switch, Text } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { Plus } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/ui/DataTable'
import { PageHeader } from '@/components/ui/PageHeader'
import { useAdminPortalMessages, useSavePortalMessage } from '../hooks/use-portal-messages'
import type { PortalMessageInput } from '../schema'
import type { PortalMessageRecord } from '../service'
import { PortalMessageForm } from './PortalMessageForm'
import { RowActions } from './RowActions'
import { PortalMessageDialog } from './PortalMessageDialog'

const SECTION_LABELS: Record<string, string> = {
  dashboard: 'Panel general',
  'risk-score': 'Puntaje de riesgo',
  'security-review': 'Revisión de seguridad',
  tasks: 'Tareas',
  inventory: 'Inventario',
  administration: 'Administración',
}

export function PortalMessagesAdminPage() {
  const [opened, { open, close }] = useDisclosure(false)
  const [editing, setEditing] = useState<PortalMessageRecord | null>(null)
  const [previewing, setPreviewing] = useState<PortalMessageRecord | null>(null)
  const query = useAdminPortalMessages([])
  const save = useSavePortalMessage()

  const startNew = () => {
    setEditing(null)
    open()
  }
  const startEdit = (message: PortalMessageRecord) => {
    setEditing(message)
    open()
  }
  const startPreview = (message: PortalMessageRecord) => setPreviewing(message)
  const toggleActive = (message: PortalMessageRecord) => {
    const input: PortalMessageInput = { ...message, is_active: !message.is_active }
    void save.mutateAsync({ input, id: message.id })
  }

  const columns: ColumnDef<PortalMessageRecord, unknown>[] = [
    {
      accessorKey: 'title',
      header: 'Título',
      cell: ({ row }) => (
        <Stack gap={2}>
          <Text fw={600} size="sm">
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
      cell: ({ getValue }) => (getValue() === 'actionable' ? 'Accionable' : 'Aviso'),
    },
    {
      id: 'audience',
      header: 'Audiencia',
      cell: ({ row }) =>
        row.original.audience.scope === 'global'
          ? 'Global'
          : `${row.original.audience.organization_ids.length} organizaciones`,
    },
    {
      accessorKey: 'expires_at',
      header: 'Expira',
      cell: ({ getValue }) => {
        const value = getValue<string | null | undefined>()
        return value ? new Date(value).toLocaleDateString('es-AR') : 'Sin fecha'
      },
    },
    {
      accessorKey: 'is_active',
      header: 'Activo',
      cell: ({ row }) => (
        <Switch
          aria-label={`${row.original.is_active ? 'Desactivar' : 'Activar'} ${row.original.title}`}
          checked={row.original.is_active}
          onChange={() => toggleActive(row.original)}
        />
      ),
    },
    {
      id: 'actions',
      header: 'Acciones',
      enableSorting: false,
      meta: { align: 'center' },
      cell: ({ row }) => (
        <RowActions message={row.original} onPreview={startPreview} onEdit={startEdit} />
      ),
    },
  ]

  const previewMessage = previewing
    ? {
        id: previewing.id,
        title: previewing.title,
        description: previewing.description,
        message_type: previewing.message_type,
        cta_label: previewing.cta_label,
        entity: previewing.linked_section
          ? {
              relationTo: previewing.linked_entity_type ?? previewing.linked_section,
              label: previewing.linked_entity
                ? 'Entidad específica enlazada'
                : SECTION_LABELS[previewing.linked_section],
              access: 'allowed' as const,
            }
          : null,
      }
    : null

  return (
    <Stack gap="lg">
      <PageHeader
        title="Mensajes del portal"
        description="Crea avisos y acciones dirigidos a organizaciones y sus usuarios."
        rightSection={
          <Button leftSection={<Plus size={16} />} onClick={startNew}>
            Nuevo mensaje
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={query.data?.docs ?? []}
        isLoading={query.isPending}
        emptyLabel="Todavía no hay mensajes."
        minWidth={800}
      />
      {query.isError && <Badge color="red">No se pudieron cargar los mensajes.</Badge>}
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
      <Modal
        opened={Boolean(previewing)}
        onClose={() => setPreviewing(null)}
        title="Vista previa del mensaje"
        size="md"
        centered
      >
        <PortalMessageDialog
          message={previewMessage}
          opened={Boolean(previewing)}
          variant="inline"
          readOnly
          onClose={() => setPreviewing(null)}
        />
      </Modal>
    </Stack>
  )
}
