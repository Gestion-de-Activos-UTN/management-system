'use client'

import { useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Group,
  Modal,
  Paper,
  Select,
  Skeleton,
  Stack,
  Switch,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { Plus, Search } from 'lucide-react'
import { FilterBar } from '@/components/ui/FilterBar'
import { MultiFilterSelect } from '@/components/ui/MultiFilterSelect'
import { matchesSearch } from '@/lib/search-text'
import { OneLineText } from '@/components/ui/OneLineText'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { formatDate, formatDateTime } from '@/lib/format-date'
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
import classes from './PortalMessagesList.module.css'

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
  const [order, setOrder] = useState('recent')
  const [search, setSearch] = useState('')
  const [types, setTypes] = useState<string[]>([])
  const [statuses, setStatuses] = useState<string[]>([])
  const allMessages = query.data?.docs ?? []
  const filtersActive = Boolean(search.trim() || types.length || statuses.length)
  const clearFilters = () => {
    setSearch('')
    setTypes([])
    setStatuses([])
  }
  const messages = allMessages
    .filter(
      message =>
        matchesSearch([message.title, message.description], search) &&
        (!types.length || types.includes(message.message_type)) &&
        (!statuses.length || statuses.includes(portalMessageStatus(message)))
    )
    .sort((left, right) => {
      if (order === 'title')
        return left.title.localeCompare(right.title, 'es', { sensitivity: 'base' })
      if (order === 'expires')
        return (
          (left.expires_at ? Date.parse(left.expires_at) : Infinity) -
          (right.expires_at ? Date.parse(right.expires_at) : Infinity)
        )
      const difference =
        (Date.parse(left.createdAt ?? '') || 0) - (Date.parse(right.createdAt ?? '') || 0)
      return order === 'oldest' ? difference : -difference
    })
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
      <FilterBar>
        <TextInput
          placeholder="Buscar mensaje…"
          aria-label="Buscar por título o descripción"
          leftSection={<Search size={16} strokeWidth={1.5} />}
          value={search}
          onChange={event => setSearch(event.currentTarget.value)}
        />
        <MultiFilterSelect
          ariaLabel="Tipo de mensaje"
          allLabel="Todos los tipos"
          data={Object.entries(PORTAL_MESSAGE_TYPE_LABELS).map(([value, label]) => ({
            value,
            label,
          }))}
          value={types}
          onChange={setTypes}
        />
        <MultiFilterSelect
          ariaLabel="Estado del mensaje"
          allLabel="Todos los estados"
          data={Object.entries(PORTAL_MESSAGE_STATUS_LABELS).map(([value, label]) => ({
            value,
            label,
          }))}
          value={statuses}
          onChange={setStatuses}
        />
        <Select
          aria-label="Ordenar mensajes"
          data={[
            { value: 'recent', label: 'Más recientes' },
            { value: 'oldest', label: 'Más antiguos' },
            { value: 'title', label: 'Título: A–Z' },
            { value: 'expires', label: 'Próximos a vencer' },
          ]}
          value={order}
          onChange={value => setOrder(value ?? 'recent')}
          allowDeselect={false}
        />
      </FilterBar>
      {query.isError && <Alert color="red">No se pudieron cargar los mensajes.</Alert>}
      {query.isPending ? (
        <Stack gap="md" aria-label="Cargando mensajes">
          {[0, 1, 2].map(key => (
            <Skeleton key={key} height={120} radius="lg" />
          ))}
        </Stack>
      ) : !query.isError && !messages.length ? (
        <Paper withBorder radius="lg" p="xl">
          <Stack gap="sm" align="flex-start">
            <Text c="dimmed">
              {allMessages.length
                ? 'Ningún mensaje coincide con la búsqueda y los filtros.'
                : 'Todavía no hay mensajes.'}
            </Text>
            {filtersActive && (
              <Button variant="subtle" onClick={clearFilters}>
                Limpiar filtros
              </Button>
            )}
          </Stack>
        </Paper>
      ) : messages.length > 0 ? (
        <Stack gap="sm">
          <Group justify="space-between" gap="sm">
            <Text size="sm" c="dimmed">
              {filtersActive
                ? `${messages.length} de ${plural(allMessages.length, 'mensaje', 'mensajes')}`
                : plural(messages.length, 'mensaje', 'mensajes')}
            </Text>
            {filtersActive && (
              <Button variant="subtle" size="compact-sm" onClick={clearFilters}>
                Limpiar filtros
              </Button>
            )}
          </Group>
          <Paper
            component="ul"
            withBorder
            radius="lg"
            className={classes.adminList}
            aria-label="Mensajes del portal"
          >
            {messages.map(message => {
              const summary = audienceSummary(message.audience, id => organizations.get(id))
              const status = portalMessageStatus(message)
              return (
                <Box component="li" key={message.id} className={classes.adminItem}>
                  <Stack gap="xs" className={classes.content}>
                    <Group gap={6}>
                      <StatusBadge
                        size="xs"
                        tone={PORTAL_MESSAGE_TYPE_TONES[message.message_type]}
                        label={PORTAL_MESSAGE_TYPE_LABELS[message.message_type]}
                      />
                      <StatusBadge
                        size="xs"
                        tone={PORTAL_MESSAGE_STATUS_TONES[status]}
                        label={PORTAL_MESSAGE_STATUS_LABELS[status]}
                      />
                    </Group>
                    <UnstyledButton
                      className={classes.previewTitle}
                      onClick={() => setPreviewing(message)}
                      aria-label={`Vista previa de ${message.title}`}
                    >
                      <Text fw={600} size="sm">
                        {message.title}
                      </Text>
                    </UnstyledButton>
                    <OneLineText c="dimmed" size="sm">
                      {message.description}
                    </OneLineText>
                    {message.createdAt && (
                      <Text size="xs" c="dimmed">
                        Creado {formatDateTime(message.createdAt)}
                      </Text>
                    )}
                  </Stack>
                  <Stack gap={2} className={classes.audience}>
                    <Text size="xs" c="dimmed">
                      Destinatarios
                    </Text>
                    <Text size="sm">{summary.primary}</Text>
                    <Text size="xs" c="dimmed">
                      {summary.secondary}
                    </Text>
                  </Stack>
                  <Stack gap="sm" className={classes.delivery}>
                    <Text size="xs" c="dimmed">
                      {message.expires_at
                        ? `Vence ${formatDate(message.expires_at)}`
                        : 'Sin vencimiento'}
                    </Text>
                    <Switch
                      label="Activo"
                      aria-label={`${message.is_active ? 'Desactivar' : 'Activar'} ${message.title}`}
                      checked={message.is_active}
                      disabled={setActive.isPending && setActive.variables?.id === message.id}
                      onChange={() => toggleActive(message)}
                    />
                  </Stack>
                  <Box className={classes.actions}>
                    <RowActions message={message} onPreview={setPreviewing} onEdit={startEdit} />
                  </Box>
                </Box>
              )
            })}
          </Paper>
        </Stack>
      ) : null}
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
