'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Collapse,
  Group,
  MultiSelect,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core'
import { ChevronDown, Eye, FileText, Link2, Plus, Save, UsersRound } from 'lucide-react'
import { formatDateInput, localDateEndToISOString } from '@/lib/format-date'
import {
  PortalMessageInputSchema,
  PortalMessageEntityTypes,
  PORTAL_MESSAGE_ENTITY_SECTION,
  type PortalMessageInput,
} from '../schema'
import { PORTAL_MESSAGE_TEMPLATES } from '../templates'
import {
  useAdminPortalMessages,
  usePortalMessageEntityOptions,
  useSavePortalMessage,
} from '../hooks/use-portal-messages'
import type { PortalMessageRecord } from '../service'
import { PortalMessageDialog } from './PortalMessageDialog'

const SECTION_OPTIONS = [
  { value: 'dashboard', label: 'Panel general' },
  { value: 'risk-score', label: 'Puntaje de riesgo' },
  { value: 'security-review', label: 'Revisión de seguridad' },
  { value: 'tasks', label: 'Tareas' },
  { value: 'inventory', label: 'Inventario' },
  { value: 'administration', label: 'Administración' },
]
const ENTITY_LABELS: Record<(typeof PortalMessageEntityTypes)[number], string> = {
  tasks: 'Tareas',
  offices: 'Oficinas',
  assets: 'Activos de red',
  'non-network-assets': 'Activos manuales',
  'assessment-instances': 'Revisiones de seguridad',
  'compliance-results': 'Resultados de controles',
  'inventory-snapshots': 'Instantáneas',
  'scan-reports': 'Escaneos',
  'risk-evaluations': 'Evaluaciones de riesgo',
  agents: 'Agentes',
}
const ROLE_OPTIONS = [
  { value: 'org_admin', label: 'Administrador de organización' },
  { value: 'org_viewer', label: 'Visualizador de organización' },
  { value: 'office_manager', label: 'Responsable de oficina' },
]

type FormState = {
  title: string
  description: string
  messageType: 'notice' | 'actionable'
  scope: 'global' | 'organizations'
  targetKind: 'all' | 'role' | 'user'
  organizationIds: string[]
  roleSlugs: string[]
  userIds: string[]
  templateKey: string
  ctaLabel: string
  linkedSection: string
  entityType: string
  entityId: string
  expiresAt: string
  isActive: boolean
}

function emptyForm(): FormState {
  return {
    title: '',
    description: '',
    messageType: 'notice',
    scope: 'organizations',
    targetKind: 'all',
    organizationIds: [],
    roleSlugs: [],
    userIds: [],
    templateKey: '',
    ctaLabel: '',
    linkedSection: '',
    entityType: '',
    entityId: '',
    expiresAt: '',
    isActive: true,
  }
}

function formFromMessage(message: PortalMessageRecord): FormState {
  const audience = message.audience
  return {
    ...emptyForm(),
    title: message.title,
    description: message.description,
    messageType: message.message_type,
    scope: audience.scope,
    targetKind: audience.scope === 'organizations' ? audience.target_kind : 'all',
    organizationIds: audience.scope === 'organizations' ? audience.organization_ids : [],
    roleSlugs:
      audience.scope === 'organizations' && audience.target_kind === 'role'
        ? audience.role_slugs
        : [],
    userIds:
      audience.scope === 'organizations' && audience.target_kind === 'user'
        ? audience.user_ids
        : [],
    templateKey: message.template_key ?? '',
    ctaLabel: message.cta_label ?? '',
    linkedSection: message.linked_section ?? '',
    entityType: message.linked_entity_type ?? '',
    entityId: message.linked_entity?.value ?? '',
    expiresAt: message.expires_at ? formatDateInput(message.expires_at) : '',
    isActive: message.is_active,
  }
}

export function PortalMessageForm({
  message,
  onSaved,
}: {
  message: PortalMessageRecord | null
  onSaved: () => void
}) {
  const [form, setForm] = useState(() => (message ? formFromMessage(message) : emptyForm()))
  const [activeTab, setActiveTab] = useState<string | null>('content')
  const [organizationDropdownOpen, setOrganizationDropdownOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const optionsQuery = useAdminPortalMessages(
    form.scope === 'organizations' ? form.organizationIds : []
  )
  const entityQuery = usePortalMessageEntityOptions(
    form.scope,
    form.scope === 'organizations' ? form.organizationIds : [],
    form.entityType || null
  )
  const save = useSavePortalMessage()
  const organizations = optionsQuery.data?.organizations ?? []
  const availableUsers = useMemo(() => {
    const users = optionsQuery.data?.users ?? []
    return Array.from(new Map(users.map(user => [user.id, user])).values())
  }, [optionsQuery.data?.users])
  const entityOptions = entityQuery.data ?? []
  const selectedEntity = entityOptions.find(option => option.value === form.entityId)

  useEffect(() => {
    if (activeTab !== 'audience') setOrganizationDropdownOpen(false)
  }, [activeTab])

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm(current => ({ ...current, [key]: value }))

  const onSectionChange = (section: string | null) => {
    setForm(current => ({ ...current, linkedSection: section ?? '', entityType: '', entityId: '' }))
  }
  const onEntityTypeChange = (type: string | null) => {
    setForm(current => ({ ...current, entityType: type ?? '', entityId: '' }))
  }

  const buildInput = (): PortalMessageInput => {
    const audience: PortalMessageInput['audience'] =
      form.scope === 'global'
        ? { scope: 'global' }
        : form.targetKind === 'role'
          ? {
              scope: 'organizations',
              target_kind: 'role',
              organization_ids: form.organizationIds,
              role_slugs: form.roleSlugs as ('org_admin' | 'org_viewer' | 'office_manager')[],
            }
          : form.targetKind === 'user'
            ? {
                scope: 'organizations',
                target_kind: 'user',
                organization_ids: form.organizationIds,
                user_ids: form.userIds,
              }
            : { scope: 'organizations', target_kind: 'all', organization_ids: form.organizationIds }
    return {
      title: form.title,
      description: form.description,
      message_type: form.messageType,
      template_key: form.templateKey || undefined,
      cta_label: form.messageType === 'actionable' ? form.ctaLabel.trim() || null : null,
      audience,
      linked_section: (form.linkedSection || null) as PortalMessageInput['linked_section'],
      linked_entity_type: (form.entityId
        ? form.entityType
        : null) as PortalMessageInput['linked_entity_type'],
      linked_entity:
        form.entityType && form.entityId
          ? {
              relationTo: form.entityType as NonNullable<PortalMessageInput['linked_entity_type']>,
              value: form.entityId,
            }
          : null,
      expires_at: form.expiresAt ? localDateEndToISOString(form.expiresAt) : null,
      is_active: form.isActive,
    }
  }

  const submit = async () => {
    setErrorMessage('')
    const parsed = PortalMessageInputSchema.safeParse(buildInput())
    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? 'Revisa los datos del mensaje.')
      return
    }
    try {
      await save.mutateAsync({ input: parsed.data, id: message?.id })
      onSaved()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo guardar el mensaje.')
    }
  }

  const templateOptions = PORTAL_MESSAGE_TEMPLATES.map(template => ({
    value: template.key,
    label: template.label,
  }))
  const typeOptions = PortalMessageEntityTypes.filter(
    type => PORTAL_MESSAGE_ENTITY_SECTION[type] === form.linkedSection
  ).map(type => ({ value: type, label: ENTITY_LABELS[type] }))
  const preview = {
    id: 'preview',
    title: form.title || 'Título del mensaje',
    description: form.description || 'La descripción aparecerá aquí.',
    message_type: form.messageType,
    cta_label: form.ctaLabel || null,
    entity: form.linkedSection
      ? {
          relationTo: form.entityType || form.linkedSection,
          label:
            selectedEntity?.label ??
            SECTION_OPTIONS.find(item => item.value === form.linkedSection)?.label,
          href: '#',
          access: 'allowed' as const,
        }
      : null,
  }

  return (
    <Stack gap="md">
      <Tabs value={activeTab} onChange={setActiveTab} keepMounted={false}>
        <Tabs.List grow>
          <Tabs.Tab value="content" leftSection={<FileText size={16} strokeWidth={1.5} />}>
            Contenido
          </Tabs.Tab>
          <Tabs.Tab value="audience" leftSection={<UsersRound size={16} strokeWidth={1.5} />}>
            Audiencia
          </Tabs.Tab>
          <Tabs.Tab value="delivery" leftSection={<Link2 size={16} strokeWidth={1.5} />}>
            Enlace y vigencia
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="content" pt="md">
          <Stack gap="md">
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Select
                label="Plantilla"
                placeholder="Sin plantilla"
                clearable
                data={templateOptions}
                value={form.templateKey || null}
                onChange={value => {
                  const template = PORTAL_MESSAGE_TEMPLATES.find(item => item.key === value)
                  setForm(current => ({
                    ...current,
                    templateKey: value ?? '',
                    ...(template
                      ? {
                          title: template.title,
                          description: template.description,
                          messageType: template.message_type,
                        }
                      : {}),
                  }))
                }}
              />
              <Select
                label="Tipo de mensaje"
                data={[
                  { value: 'notice', label: 'Aviso' },
                  { value: 'actionable', label: 'Accionable' },
                ]}
                value={form.messageType}
                onChange={value =>
                  update('messageType', (value ?? 'notice') as FormState['messageType'])
                }
              />
            </SimpleGrid>
            <TextInput
              label="Título"
              required
              maxLength={100}
              description={`${form.title.length}/100 caracteres`}
              value={form.title}
              onChange={event => update('title', event.currentTarget.value)}
            />
            <Textarea
              label="Descripción"
              required
              maxLength={500}
              minRows={3}
              autosize
              description={`${form.description.length}/500 caracteres`}
              value={form.description}
              onChange={event => update('description', event.currentTarget.value)}
            />
            {form.messageType === 'actionable' && (
              <TextInput
                label="Texto de la acción"
                maxLength={30}
                description={`${form.ctaLabel.length}/30 caracteres. Si queda vacío, se muestra “Ver”.`}
                value={form.ctaLabel}
                onChange={event => update('ctaLabel', event.currentTarget.value)}
              />
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="audience" pt="md">
          <Stack gap="md">
            <Paper withBorder radius="md" p="md">
              <Stack gap="xs">
                <Text size="sm" fw={600}>
                  Alcance del mensaje
                </Text>
                <Text size="xs" c="dimmed">
                  Define si se envía a todas las organizaciones o si eliges quién lo recibe.
                </Text>
                <Switch
                  label="Mensaje global"
                  description="Se dirige a todas las organizaciones activas."
                  checked={form.scope === 'global'}
                  onChange={event => {
                    const checked = event.currentTarget.checked
                    setOrganizationDropdownOpen(false)
                    setForm(current => ({
                      ...current,
                      scope: checked ? 'global' : 'organizations',
                      organizationIds: [],
                      roleSlugs: [],
                      userIds: [],
                      entityId: '',
                    }))
                  }}
                />
              </Stack>
            </Paper>
            {form.scope === 'organizations' && (
              <Stack gap="md">
                <Stack gap={2}>
                  <Text size="sm" fw={600}>
                    Destinatarios por organización
                  </Text>
                  <Text size="xs" c="dimmed">
                    Primero selecciona las organizaciones y luego quiénes de cada una recibirá el
                    mensaje.
                  </Text>
                </Stack>
                <MultiSelect
                  label="¿A qué organizaciones?"
                  placeholder="Selecciona una o más organizaciones"
                  description="El mensaje solo se enviará a las organizaciones seleccionadas."
                  searchable
                  onDropdownOpen={() => {
                    setOrganizationDropdownOpen(true)
                    setPreviewOpen(false)
                  }}
                  onDropdownClose={() => setOrganizationDropdownOpen(false)}
                  data={organizations.map(org => ({ value: org.id, label: org.name }))}
                  value={form.organizationIds}
                  onChange={value =>
                    setForm(current => ({
                      ...current,
                      organizationIds: value,
                      userIds: [],
                      entityId: '',
                    }))
                  }
                />
                {organizationDropdownOpen ? (
                  <Text size="sm" c="dimmed">
                    Cierra la lista de organizaciones para elegir quiénes recibirán el mensaje.
                  </Text>
                ) : (
                  <>
                    <Select
                      label="¿Quiénes dentro de esas organizaciones?"
                      data={[
                        { value: 'all', label: 'Todas las personas de cada organización' },
                        { value: 'role', label: 'Personas con roles específicos' },
                        { value: 'user', label: 'Personas específicas' },
                      ]}
                      value={form.targetKind}
                      onChange={value =>
                        setForm(current => ({
                          ...current,
                          targetKind: (value ?? 'all') as FormState['targetKind'],
                          roleSlugs: [],
                          userIds: [],
                        }))
                      }
                    />
                    {form.targetKind === 'role' && (
                      <MultiSelect
                        label="¿Qué roles recibirán el mensaje?"
                        data={ROLE_OPTIONS}
                        value={form.roleSlugs}
                        onChange={value => update('roleSlugs', value)}
                      />
                    )}
                    {form.targetKind === 'user' && (
                      <MultiSelect
                        label="¿Qué personas lo recibirán?"
                        searchable
                        data={availableUsers.map(user => ({
                          value: user.id,
                          label: `${user.name} · ${user.email}`,
                        }))}
                        value={form.userIds}
                        onChange={value => update('userIds', value)}
                        description="Solo aparecen personas activas de las organizaciones elegidas."
                      />
                    )}
                  </>
                )}
              </Stack>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="delivery" pt="md">
          <Stack gap="md">
            <Select
              label="Sección del portal (opcional)"
              placeholder="Sin enlace a una sección"
              clearable
              data={SECTION_OPTIONS}
              value={form.linkedSection || null}
              onChange={onSectionChange}
              description="Puedes enlazar una sección sola o agregar una entidad concreta."
            />
            {form.linkedSection && typeOptions.length > 0 && (
              <SimpleGrid cols={{ base: 1, sm: form.entityType ? 2 : 1 }}>
                <Select
                  label="Tipo de entidad específica (opcional)"
                  placeholder="Solo abrir la sección"
                  clearable
                  data={typeOptions}
                  value={form.entityType || null}
                  onChange={onEntityTypeChange}
                />
                {form.entityType && (
                  <Select
                    label="Entidad específica (opcional)"
                    placeholder={
                      entityQuery.isSuccess && !entityOptions.length
                        ? 'No hay entidades comunes'
                        : 'Selecciona una entidad'
                    }
                    searchable
                    clearable
                    disabled={entityQuery.isPending || !entityOptions.length}
                    data={entityOptions.map(option => ({
                      value: option.value,
                      label: option.label,
                    }))}
                    value={form.entityId || null}
                    onChange={value => update('entityId', value ?? '')}
                  />
                )}
              </SimpleGrid>
            )}
            {form.entityType && entityQuery.isSuccess && !entityOptions.length && (
              <Text size="sm" c="dimmed">
                No hay una entidad concreta compartida por todas las organizaciones destinatarias.
                Puedes enlazar la sección.
              </Text>
            )}
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput
                label="Fecha de expiración"
                type="date"
                value={form.expiresAt}
                onChange={event => update('expiresAt', event.currentTarget.value)}
              />
              <Switch
                mt="xl"
                label="Mensaje activo"
                checked={form.isActive}
                onChange={event => update('isActive', event.currentTarget.checked)}
              />
            </SimpleGrid>
          </Stack>
        </Tabs.Panel>
      </Tabs>

      {errorMessage && <Alert color="red">{errorMessage}</Alert>}

      {!organizationDropdownOpen && (
        <Group justify="space-between" pt="xs">
          <Button
            variant={previewOpen ? 'light' : 'subtle'}
            leftSection={<Eye size={16} strokeWidth={1.5} />}
            rightSection={
              <ChevronDown
                size={16}
                strokeWidth={1.5}
                style={{
                  transform: previewOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 280ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              />
            }
            aria-expanded={previewOpen}
            aria-controls="portal-message-preview"
            onClick={() => setPreviewOpen(value => !value)}
          >
            {previewOpen ? 'Ocultar vista previa' : 'Vista previa'}
          </Button>
          <Button
            leftSection={message ? <Save size={16} /> : <Plus size={16} />}
            loading={save.isPending}
            onClick={() => void submit()}
          >
            {message ? 'Guardar cambios' : 'Crear mensaje'}
          </Button>
        </Group>
      )}

      <Collapse
        id="portal-message-preview"
        in={previewOpen && !organizationDropdownOpen}
        transitionDuration={320}
        transitionTimingFunction="cubic-bezier(0.16, 1, 0.3, 1)"
        animateOpacity
      >
        <Paper withBorder radius="md" p="md" bg="var(--mantine-color-default-hover)">
          <Stack gap="sm">
            <Text size="sm" fw={600} c="dimmed" ta="center">
              Así verá el mensaje la persona destinataria
            </Text>
            <PortalMessageDialog message={preview} opened variant="inline" onClose={() => {}} />
          </Stack>
        </Paper>
      </Collapse>
    </Stack>
  )
}
