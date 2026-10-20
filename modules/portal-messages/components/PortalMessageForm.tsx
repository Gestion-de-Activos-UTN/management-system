'use client'

import { textRuleError } from '@/lib/text-rules'
import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Collapse,
  Group,
  MultiSelect,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
} from '@mantine/core'
import { ChevronDown, Eye, FileText, Link2, Plus, Save, UsersRound } from 'lucide-react'
import { SettingRow } from '@/components/ui/SettingRow'
import { CharacterCountTextarea } from '@/components/ui/CharacterCountTextarea'
import { formatDateInput, localDateEndToISOString } from '@/lib/format-date'
import { userFacingErrorMessage } from '@/lib/user-facing-error'
import { ROLE_LABELS } from '@/lib/role-labels'
import {
  PortalMessageInputSchema,
  PortalMessageEntityTypes,
  PORTAL_MESSAGE_ENTITY_SECTION,
  PORTAL_MESSAGE_ROLES,
  PORTAL_MESSAGE_SECTIONS,
  type PortalMessageInput,
} from '../schema'
import { PORTAL_MESSAGE_TEMPLATES } from '../templates'
import {
  PORTAL_MESSAGE_ENTITY_TYPE_LABELS,
  PORTAL_MESSAGE_SECTION_LINKS,
  PORTAL_MESSAGE_TYPE_LABELS,
} from '../portal-message-labels'
import {
  useAdminPortalMessages,
  usePortalMessageEntityOptions,
  useSavePortalMessage,
} from '../hooks/use-portal-messages'
import type { PortalMessageRecord } from '../service'
import { PortalMessageDialog } from './PortalMessageDialog'

const SECTION_OPTIONS = PORTAL_MESSAGE_SECTIONS.map(value => ({
  value,
  label: PORTAL_MESSAGE_SECTION_LINKS[value].label,
}))
const ROLE_OPTIONS = PORTAL_MESSAGE_ROLES.map(value => ({ value, label: ROLE_LABELS[value] }))
const TYPE_OPTIONS = (['notice', 'actionable'] as const).map(value => ({
  value,
  label: PORTAL_MESSAGE_TYPE_LABELS[value],
}))
const TEMPLATE_OPTIONS = PORTAL_MESSAGE_TEMPLATES.map(template => ({
  value: template.key,
  label: template.label,
}))

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
type Tab = 'content' | 'audience' | 'delivery'
type FieldErrors = Partial<Record<keyof FormState, string>>

// Ruta del issue de Zod → campo del formulario y pestaña donde vive.
const ISSUE_FIELDS: Record<string, { field: keyof FormState; tab: Tab }> = {
  title: { field: 'title', tab: 'content' },
  description: { field: 'description', tab: 'content' },
  cta_label: { field: 'ctaLabel', tab: 'content' },
  'audience.organization_ids': { field: 'organizationIds', tab: 'audience' },
  'audience.role_slugs': { field: 'roleSlugs', tab: 'audience' },
  'audience.user_ids': { field: 'userIds', tab: 'audience' },
  linked_section: { field: 'linkedSection', tab: 'delivery' },
  linked_entity_type: { field: 'entityType', tab: 'delivery' },
  linked_entity: { field: 'entityId', tab: 'delivery' },
  expires_at: { field: 'expiresAt', tab: 'delivery' },
}
const TAB_FIELDS = Object.values(ISSUE_FIELDS).reduce<Record<Tab, (keyof FormState)[]>>(
  (tabs, { field, tab }) => ({ ...tabs, [tab]: [...tabs[tab], field] }),
  { content: [], audience: [], delivery: [] }
)

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

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

export function PortalMessageForm({
  message,
  onSaved,
}: {
  message: PortalMessageRecord | null
  onSaved: () => void
}) {
  const [form, setForm] = useState(() => (message ? formFromMessage(message) : emptyForm()))
  const [activeTab, setActiveTab] = useState<Tab>('content')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [pendingTemplate, setPendingTemplate] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [errorMessage, setErrorMessage] = useState('')
  const optionsQuery = useAdminPortalMessages(
    form.scope === 'organizations' ? form.organizationIds : []
  )
  const save = useSavePortalMessage()
  const organizations = optionsQuery.data?.organizations ?? []

  // Un mensaje guardado puede apuntar a organizaciones que se desactivaron o a personas que
  // dejaron la organización: no se muestran como opción, se avisa y se quitan al guardar.
  const optionsLoaded = optionsQuery.isSuccess && form.scope === 'organizations'
  const activeOrganizationIds = new Set(organizations.map(organization => organization.id))
  const organizationIds = optionsLoaded
    ? form.organizationIds.filter(id => activeOrganizationIds.has(id))
    : form.organizationIds
  const staleOrganizations = form.organizationIds.length - organizationIds.length
  const availableUsers = (optionsQuery.data?.users ?? []).filter(user =>
    organizationIds.includes(user.organization_id)
  )
  const userIds =
    optionsLoaded && form.targetKind === 'user'
      ? form.userIds.filter(id => availableUsers.some(user => user.id === id))
      : form.userIds
  const staleUsers = form.targetKind === 'user' ? form.userIds.length - userIds.length : 0

  const entityQuery = usePortalMessageEntityOptions(
    form.scope,
    form.scope === 'organizations' ? organizationIds : [],
    form.entityType || null
  )
  const entityOptions = useMemo(() => {
    const docs = entityQuery.data ?? []
    const saved = message?.linked_entity
    // La entidad guardada puede quedar fuera del tope de opciones: se conserva con su etiqueta.
    if (
      saved &&
      saved.value === form.entityId &&
      message.linked_entity_label &&
      !docs.some(doc => doc.value === saved.value)
    ) {
      return [{ ...saved, label: message.linked_entity_label }, ...docs]
    }
    return docs
  }, [entityQuery.data, form.entityId, message])
  const selectedEntity = entityOptions.find(option => option.value === form.entityId)

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(current => ({ ...current, [key]: value }))
    setFieldErrors(({ [key]: _, ...rest }) => rest as FieldErrors)
  }

  const onSectionChange = (section: string | null) => {
    setForm(current => ({ ...current, linkedSection: section ?? '', entityType: '', entityId: '' }))
    setFieldErrors({})
  }
  const onEntityTypeChange = (type: string | null) => {
    setForm(current => ({ ...current, entityType: type ?? '', entityId: '' }))
  }

  const applyTemplate = (key: string) => {
    const template = PORTAL_MESSAGE_TEMPLATES.find(item => item.key === key)
    if (!template) return
    setPendingTemplate(null)
    setFieldErrors({})
    setForm(current => ({
      ...current,
      templateKey: key,
      title: template.title,
      description: template.description,
      messageType: template.message_type,
    }))
  }
  const onTemplateChange = (key: string | null) => {
    if (!key) {
      setPendingTemplate(null)
      return update('templateKey', '')
    }
    const template = PORTAL_MESSAGE_TEMPLATES.find(item => item.key === key)
    const hasOwnText =
      (form.title.trim() || form.description.trim()) &&
      (form.title !== template?.title || form.description !== template?.description)
    if (hasOwnText) setPendingTemplate(key)
    else applyTemplate(key)
  }

  const buildInput = (): PortalMessageInput => {
    const audience: PortalMessageInput['audience'] =
      form.scope === 'global'
        ? { scope: 'global' }
        : form.targetKind === 'role'
          ? {
              scope: 'organizations',
              target_kind: 'role',
              organization_ids: organizationIds,
              role_slugs: form.roleSlugs as (typeof PORTAL_MESSAGE_ROLES)[number][],
            }
          : form.targetKind === 'user'
            ? {
                scope: 'organizations',
                target_kind: 'user',
                organization_ids: organizationIds,
                user_ids: userIds,
              }
            : { scope: 'organizations', target_kind: 'all', organization_ids: organizationIds }
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
    setFieldErrors({})
    const parsed = PortalMessageInputSchema.safeParse(buildInput())
    if (!parsed.success) {
      const errors: FieldErrors = {}
      let firstTab: Tab | null = null
      const unmapped: string[] = []
      for (const issue of parsed.error.issues) {
        const key =
          issue.path[0] === 'audience' ? `audience.${String(issue.path[1])}` : String(issue.path[0])
        const target = ISSUE_FIELDS[key]
        if (!target) unmapped.push(issue.message)
        else if (!errors[target.field]) {
          errors[target.field] = issue.message
          firstTab ??= target.tab
        }
      }
      setFieldErrors(errors)
      if (firstTab) setActiveTab(firstTab)
      if (unmapped.length) setErrorMessage(unmapped[0])
      return
    }
    try {
      await save.mutateAsync({ input: parsed.data, id: message?.id })
      onSaved()
    } catch (error) {
      setErrorMessage(userFacingErrorMessage(error, 'No se pudo guardar el mensaje.'))
    }
  }

  const typeOptions = PortalMessageEntityTypes.filter(
    type => PORTAL_MESSAGE_ENTITY_SECTION[type] === form.linkedSection
  ).map(type => ({ value: type, label: PORTAL_MESSAGE_ENTITY_TYPE_LABELS[type] }))
  const preview = {
    id: 'preview',
    title: form.title || 'Título del mensaje',
    description: form.description || 'La descripción aparecerá aquí.',
    message_type: form.messageType,
    cta_label: form.ctaLabel || null,
    entity: form.linkedSection
      ? selectedEntity
        ? {
            kind: 'entity' as const,
            relationTo: form.entityType,
            label: selectedEntity.label,
            access: 'allowed' as const,
          }
        : {
            kind: 'section' as const,
            relationTo: form.linkedSection,
            label: SECTION_OPTIONS.find(item => item.value === form.linkedSection)?.label,
            access: 'allowed' as const,
          }
      : null,
  }
  const tabError = (tab: Tab) =>
    TAB_FIELDS[tab].some(field => fieldErrors[field]) ? (
      <Box w={8} h={8} bg="red.6" style={{ borderRadius: '50%' }} aria-label="Con errores" />
    ) : null

  return (
    <Stack gap="md">
      <Tabs
        value={activeTab}
        onChange={value => setActiveTab((value as Tab) ?? 'content')}
        keepMounted={false}
      >
        <Tabs.List grow>
          <Tabs.Tab
            value="content"
            leftSection={<FileText size={16} strokeWidth={1.5} />}
            rightSection={tabError('content')}
          >
            Contenido
          </Tabs.Tab>
          <Tabs.Tab
            value="audience"
            leftSection={<UsersRound size={16} strokeWidth={1.5} />}
            rightSection={tabError('audience')}
          >
            Audiencia
          </Tabs.Tab>
          <Tabs.Tab
            value="delivery"
            leftSection={<Link2 size={16} strokeWidth={1.5} />}
            rightSection={tabError('delivery')}
          >
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
                data={TEMPLATE_OPTIONS}
                value={pendingTemplate ?? (form.templateKey || null)}
                onChange={onTemplateChange}
              />
              <Select
                label="Tipo de mensaje"
                data={TYPE_OPTIONS}
                value={form.messageType}
                allowDeselect={false}
                onChange={value =>
                  update('messageType', (value ?? 'notice') as FormState['messageType'])
                }
              />
            </SimpleGrid>
            {pendingTemplate && (
              <Alert color="yellow" title="¿Reemplazar el contenido?">
                <Stack gap="sm">
                  <Text size="sm">
                    La plantilla «
                    {TEMPLATE_OPTIONS.find(option => option.value === pendingTemplate)?.label}»
                    reemplazará el título, la descripción y el tipo que escribiste.
                  </Text>
                  <Group gap="xs">
                    <Button size="xs" color="yellow" onClick={() => applyTemplate(pendingTemplate)}>
                      Reemplazar
                    </Button>
                    <Button size="xs" variant="default" onClick={() => setPendingTemplate(null)}>
                      Mantener mi texto
                    </Button>
                  </Group>
                </Stack>
              </Alert>
            )}
            <TextInput
              label="Título"
              required
              maxLength={100}
              description={`${form.title.length}/100 caracteres`}
              value={form.title}
              error={fieldErrors.title ?? textRuleError(form.title, 'title')}
              onChange={event => update('title', event.currentTarget.value)}
            />
            <CharacterCountTextarea
              label="Descripción"
              required
              maxLength={500}
              minRows={3}
              autosize
              value={form.description}
              error={fieldErrors.description ?? textRuleError(form.description, 'free')}
              onChange={event => update('description', event.currentTarget.value)}
            />
            <Collapse in={form.messageType === 'actionable'}>
              <TextInput
                label="Texto de la acción"
                maxLength={30}
                description={`${form.ctaLabel.length}/30 caracteres. Si queda vacío, se muestra “Ver”.`}
                value={form.ctaLabel}
                error={fieldErrors.ctaLabel ?? textRuleError(form.ctaLabel, 'title')}
                onChange={event => update('ctaLabel', event.currentTarget.value)}
              />
            </Collapse>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="audience" pt="md">
          <Stack gap="md">
            <SettingRow
              label="Alcance"
              labelId="portal-message-scope"
              description={
                form.scope === 'global'
                  ? 'Se dirige a todas las organizaciones activas.'
                  : 'Se dirige sólo a las organizaciones que elijas.'
              }
            >
              <SegmentedControl
                aria-labelledby="portal-message-scope"
                data={[
                  { value: 'organizations', label: 'Organizaciones específicas' },
                  { value: 'global', label: 'Todas las organizaciones' },
                ]}
                value={form.scope}
                onChange={value => {
                  setFieldErrors({})
                  setForm(current => ({
                    ...current,
                    scope: value as typeof current.scope,
                    organizationIds: [],
                    roleSlugs: [],
                    userIds: [],
                    entityId: '',
                  }))
                }}
              />
            </SettingRow>
            <Collapse in={form.scope === 'organizations'}>
              <Stack gap="md">
                {(staleOrganizations > 0 || staleUsers > 0) && (
                  <Alert color="yellow" title="Destinatarios que ya no están disponibles">
                    {[
                      staleOrganizations > 0 &&
                        plural(
                          staleOrganizations,
                          'organización inactiva',
                          'organizaciones inactivas'
                        ),
                      staleUsers > 0 &&
                        plural(
                          staleUsers,
                          'persona que ya no pertenece a las organizaciones elegidas',
                          'personas que ya no pertenecen a las organizaciones elegidas'
                        ),
                    ]
                      .filter(Boolean)
                      .join(' y ')}
                    . Se quitarán del mensaje al guardar.
                  </Alert>
                )}
                <MultiSelect
                  label="¿A qué organizaciones?"
                  placeholder="Selecciona una o más organizaciones"
                  description="El mensaje solo se enviará a las organizaciones seleccionadas."
                  searchable
                  maxDropdownHeight={220}
                  data={organizations.map(org => ({ value: org.id, label: org.name }))}
                  value={organizationIds}
                  error={fieldErrors.organizationIds}
                  onChange={value => {
                    setFieldErrors(({ organizationIds: _, ...rest }) => rest)
                    setForm(current => ({
                      ...current,
                      organizationIds: value,
                      userIds: [],
                      entityId: '',
                    }))
                  }}
                />
                <Select
                  label="¿Quiénes dentro de esas organizaciones?"
                  allowDeselect={false}
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
                    error={fieldErrors.roleSlugs}
                    onChange={value => update('roleSlugs', value)}
                  />
                )}
                {form.targetKind === 'user' && (
                  <MultiSelect
                    label="¿Qué personas lo recibirán?"
                    searchable
                    maxDropdownHeight={220}
                    disabled={!organizationIds.length}
                    placeholder={
                      organizationIds.length ? undefined : 'Primero elige las organizaciones'
                    }
                    data={availableUsers.map(user => ({
                      value: user.id,
                      label: `${user.name} · ${user.email}`,
                    }))}
                    value={userIds}
                    error={fieldErrors.userIds}
                    onChange={value => update('userIds', value)}
                    description="Solo aparecen personas activas de las organizaciones elegidas."
                  />
                )}
              </Stack>
            </Collapse>
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
              error={fieldErrors.linkedSection}
              onChange={onSectionChange}
              description={
                form.messageType === 'notice'
                  ? 'En un aviso se muestra como enlace “Abrir” junto al mensaje.'
                  : 'La acción principal del mensaje lleva a este destino.'
              }
            />
            {form.linkedSection && typeOptions.length > 0 && (
              <SimpleGrid cols={{ base: 1, sm: form.entityType ? 2 : 1 }}>
                <Select
                  label="Tipo de entidad específica (opcional)"
                  placeholder="Solo abrir la sección"
                  clearable
                  data={typeOptions}
                  value={form.entityType || null}
                  error={fieldErrors.entityType}
                  onChange={onEntityTypeChange}
                />
                {form.entityType && (
                  <Select
                    label="Entidad específica (opcional)"
                    placeholder={
                      entityQuery.isPending
                        ? 'Cargando…'
                        : entityOptions.length
                          ? 'Selecciona una entidad'
                          : 'No hay entidades comunes'
                    }
                    searchable
                    clearable
                    disabled={entityQuery.isPending || !entityOptions.length}
                    data={entityOptions.map(option => ({
                      value: option.value,
                      label: option.label,
                    }))}
                    value={form.entityId || null}
                    error={fieldErrors.entityId}
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
            <TextInput
              label="Fecha de expiración"
              description="Se muestra hasta el final de ese día."
              type="date"
              value={form.expiresAt}
              error={fieldErrors.expiresAt}
              onChange={event => update('expiresAt', event.currentTarget.value)}
            />
            <SettingRow
              label="Mensaje activo"
              labelId="portal-message-active"
              description={
                form.isActive
                  ? 'Se muestra a sus destinatarios hasta la fecha de expiración.'
                  : 'No se muestra a nadie hasta que lo actives.'
              }
            >
              <Switch
                aria-labelledby="portal-message-active"
                checked={form.isActive}
                onChange={event => update('isActive', event.currentTarget.checked)}
              />
            </SettingRow>
          </Stack>
        </Tabs.Panel>
      </Tabs>

      {errorMessage && <Alert color="red">{errorMessage}</Alert>}

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
                transition: 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)',
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
          leftSection={
            message ? <Save size={16} strokeWidth={1.5} /> : <Plus size={16} strokeWidth={1.5} />
          }
          loading={save.isPending}
          onClick={() => void submit()}
        >
          {message ? 'Guardar cambios' : 'Crear mensaje'}
        </Button>
      </Group>

      <Collapse id="portal-message-preview" in={previewOpen}>
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
