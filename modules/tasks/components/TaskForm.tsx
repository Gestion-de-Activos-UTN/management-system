'use client'

import { ModalLayout } from '@/components/ui/ModalLayout'
import { DateField } from '@/components/ui/DateField'
import { useSingleSubmission } from '@/components/ui/use-single-submission'

import { useEffect, useState, type FormEvent } from 'react'
import { useDebouncedValue } from '@mantine/hooks'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Button,
  Alert,
  Collapse,
  Group,
  MultiSelect,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Input,
  TextInput,
} from '@mantine/core'
import { CharacterCountTextarea } from '@/components/ui/CharacterCountTextarea'
import type { HttpError } from '@/lib/http-client'
import { SettingRow } from '@/components/ui/SettingRow'
import { useOfficesList } from '@/modules/offices/hooks/use-offices'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'
import {
  formatDateInput,
  localDateEndToISOString,
  localDateStartToISOString,
} from '@/lib/format-date'
import {
  CreateTasksSchema,
  TASK_REFERENCE_COLLECTIONS,
  type CreateTasksInput,
  type TaskReferenceInput,
} from '../schema'
import {
  TASK_REFERENCE_HELP,
  TASK_REFERENCE_LABELS,
  TASK_REFERENCE_TYPE_LABELS,
} from '../task-labels'
import { useCreateTasks } from '../hooks/use-task-actions'
import { useTaskAssignmentOptions, useTaskReferenceOptions } from '../hooks/use-task-options'
import { TaskAssignmentFields } from './TaskAssignmentFields'
import { TaskReferenceSummary } from './TaskReferenceSummary'

const ALL_OFFICES = '__all_offices__'

export function TaskForm({
  asOrganization,
  initialReference,
  referenceEditable = false,
  onSaved,
}: {
  asOrganization?: string
  /** Fija el tipo de entidad. Con `value` y sin `referenceEditable`, fija también la entidad. */
  initialReference?: { relationTo: TaskReferenceInput['relationTo']; value?: string }
  referenceEditable?: boolean
  onSaved?: () => void
}) {
  const create = useCreateTasks()
  const submission = useSingleSubmission()
  // One key per opened form, repeated on every retry: if a response is lost after saving, the
  // retry returns the tasks already created instead of creating them again.
  const [operationId] = useState(() =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), byte =>
      byte.toString(16).padStart(2, '0')
    ).join('')
  )
  const { data: tenant } = useTenantContext(asOrganization)
  const { data: offices } = useOfficesList(asOrganization)
  const [referenceType, setReferenceType] = useState<TaskReferenceInput['relationTo'] | null>(
    initialReference?.relationTo ?? null
  )
  const {
    control,
    handleSubmit,
    watch,
    setValue,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<CreateTasksInput>({
    resolver: zodResolver(CreateTasksSchema),
    mode: 'onChange',
    defaultValues: {
      title: '',
      description: '',
      priority: 'normal',
      start_at: undefined,
      due_at: undefined,
      global: false,
      office_ids: [],
      assignment_kind: 'open_pool',
      related_entity: initialReference?.value
        ? { relationTo: initialReference.relationTo, value: initialReference.value }
        : undefined,
    },
  })
  const global = watch('global')
  const officeIds = watch('office_ids')
  const assignmentKind = watch('assignment_kind')
  const assignedRole = watch('assigned_role')
  const assignedUser = watch('assigned_user')
  const reference = watch('related_entity')
  const referenceLocked = Boolean(initialReference?.value) && !referenceEditable
  // Lo elegido se pide por id: así se muestra aunque no esté entre los resultados de la búsqueda.
  const selectedReferenceQuery = useTaskReferenceOptions(referenceType, {
    asOrganization,
    selectedId: reference?.value,
    enabled: Boolean(reference?.value),
  })
  const selectedReference = selectedReferenceQuery.data?.docs.find(
    option => option.value === reference?.value
  )
  const [referenceSearch, setReferenceSearch] = useState('')
  // Al elegir, Mantine copia el nombre al buscador: eso no es una búsqueda.
  const [debouncedSearch] = useDebouncedValue(
    referenceSearch === selectedReference?.label ? '' : referenceSearch.trim(),
    300
  )
  const referenceOptions = useTaskReferenceOptions(referenceType, {
    asOrganization,
    search: debouncedSearch,
    enabled: !referenceLocked,
  })
  const referenceData = [
    ...(selectedReference ? [selectedReference] : []),
    ...(referenceOptions.data?.docs ?? []).filter(
      option => option.value !== selectedReference?.value
    ),
  ]
  const assignmentScopeReady = Boolean(
    tenant?.permissions.tasks.includes('create') &&
    (reference || (!referenceType && (officeIds.length || (tenant.orgWide && global))))
  )
  const assignmentOptions = useTaskAssignmentOptions(officeIds, reference, asOrganization, {
    enabled: assignmentScopeReady,
  })
  useEffect(() => {
    if (tenant && !tenant.orgWide && global) setValue('global', false)
  }, [tenant, global, setValue])

  useEffect(() => {
    if (!selectedReference) return
    if (selectedReference.office_id) {
      setValue('global', false)
      setValue('office_ids', [selectedReference.office_id])
    } else {
      setValue('global', true)
      setValue('office_ids', [])
    }
  }, [selectedReference, setValue])

  useEffect(() => {
    if (!assignmentOptions.data || assignmentOptions.isFetching) return
    if (
      assignmentKind === 'role' &&
      assignedRole &&
      !assignmentOptions.data.roles.some(role => role.id === assignedRole)
    ) {
      setValue('assigned_role', undefined)
    }
    if (
      assignmentKind === 'user' &&
      assignedUser &&
      !assignmentOptions.data.users.some(user => user.id === assignedUser)
    ) {
      setValue('assigned_user', undefined)
    }
  }, [
    assignedRole,
    assignedUser,
    assignmentKind,
    assignmentOptions.data,
    assignmentOptions.isFetching,
    setValue,
  ])

  const officeOptions = (offices ?? []).map(office => ({
    value: String(office.id),
    label: office.name,
  }))
  // Si la tarea nace desde una entidad (tipo fijo), el alcance siempre lo define esa entidad:
  // nunca se ofrece "Tarea global" ni elegir oficinas, aunque todavía no haya entidad elegida.
  const scopeLocked = Boolean(reference) || Boolean(initialReference)
  const scopeLabel = !selectedReference
    ? 'se define al elegir la entidad'
    : selectedReference.office_id
      ? `Oficina ${officeOptions.find(o => o.value === selectedReference.office_id)?.label ?? ''}`
      : 'Toda la organización'

  const referenceSelect = (
    <Controller
      name="related_entity"
      control={control}
      render={({ field }) => (
        <Select
          label={
            initialReference
              ? TASK_REFERENCE_TYPE_LABELS[initialReference.relationTo]
              : 'Entidad relacionada'
          }
          description={
            [
              initialReference ? TASK_REFERENCE_HELP[initialReference.relationTo] : null,
              referenceOptions.data?.has_more && !debouncedSearch
                ? 'Se muestran las más recientes: escribe para buscar.'
                : null,
            ]
              .filter(Boolean)
              .join(' ') || undefined
          }
          required={Boolean(referenceType)}
          placeholder={referenceType ? 'Selecciona una entidad' : 'Sin relación'}
          disabled={!referenceType}
          searchable
          searchValue={referenceSearch}
          onSearchChange={setReferenceSearch}
          // El servidor ya filtró (sin tildes ni mayúsculas): no volver a filtrar en el cliente.
          filter={({ options }) => options}
          clearable={!initialReference}
          nothingFoundMessage={referenceOptions.isFetching ? 'Buscando…' : 'Sin resultados'}
          error={errors.related_entity?.message}
          data={referenceData.map(option => ({ value: option.value, label: option.label }))}
          value={field.value?.value ?? null}
          onChange={value => {
            field.onChange(
              value && referenceType ? { relationTo: referenceType, value } : undefined
            )
            clearErrors('related_entity')
          }}
        />
      )}
    />
  )

  const validateAndSubmit = handleSubmit(async values => {
    // Elegir un tipo sin entidad crearía la tarea sin vínculo, en silencio. Se exige completar
    // la entidad o quitar el tipo.
    if (referenceType && !values.related_entity) {
      setError('related_entity', { message: 'Selecciona una entidad.' })
      return
    }
    try {
      await create.mutateAsync({ ...values, operation_id: operationId })
    } catch (error) {
      // The mutation hook reports the error. Keep the form available for a corrected retry,
      // except on a key conflict: its tasks already exist and every retry would conflict again.
      // The key is never regenerated here, or a lost response would create the tasks twice.
      const code = (error as Partial<HttpError>)?.code
      if (code === 'asset_unavailable')
        setError('related_entity', {
          message: referenceLocked
            ? 'Este activo está retirado o eliminado y ya no admite tareas nuevas.'
            : 'Selecciona otra entidad: este activo está retirado o eliminado.',
        })
      if (code !== 'task_operation_conflict') return
    }
    submission.succeed()
    onSaved?.()
  })

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    return submission.run(() => validateAndSubmit(event))
  }

  return (
    <form onSubmit={submit} noValidate>
      <ModalLayout
        gap="md"
        footer={
          <Group justify="flex-end">
            <Button
              type="submit"
              loading={isSubmitting || create.isPending}
              disabled={submission.submitted}
            >
              {officeIds.length > 1 ? `Crear ${officeIds.length} tareas` : 'Crear tarea'}
            </Button>
          </Group>
        }
      >
        {referenceLocked && initialReference && (
          <Stack gap={4}>
            <TaskReferenceSummary
              relationTo={initialReference.relationTo}
              label={
                selectedReference?.label ?? (selectedReferenceQuery.isPending ? 'Cargando…' : null)
              }
            />
            {errors.related_entity?.message && (
              <Input.Error>{errors.related_entity.message}</Input.Error>
            )}
          </Stack>
        )}
        {initialReference && !referenceLocked && referenceSelect}
        <Controller
          name="title"
          control={control}
          render={({ field }) => (
            <TextInput
              label="Título"
              required
              maxLength={160}
              value={field.value}
              onChange={field.onChange}
              error={errors.title?.message}
            />
          )}
        />
        <Controller
          name="description"
          control={control}
          render={({ field }) => (
            <CharacterCountTextarea
              label="Descripción"
              autosize
              minRows={3}
              maxRows={8}
              maxLength={5000}
              value={field.value ?? ''}
              onChange={field.onChange}
              error={errors.description?.message}
            />
          )}
        />
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <Controller
            name="priority"
            control={control}
            render={({ field }) => (
              <Select
                label="Prioridad"
                withAsterisk
                data={[
                  { value: 'low', label: 'Baja' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'high', label: 'Alta' },
                  { value: 'urgent', label: 'Urgente' },
                ]}
                value={field.value}
                onChange={value => field.onChange(value ?? 'normal')}
              />
            )}
          />
          <Controller
            name="start_at"
            control={control}
            render={({ field }) => (
              <DateField
                label="Inicio"
                value={field.value ? formatDateInput(field.value) : ''}
                onChange={value =>
                  field.onChange(value ? localDateStartToISOString(value) : undefined)
                }
                error={errors.start_at?.message}
              />
            )}
          />
          <Controller
            name="due_at"
            control={control}
            render={({ field }) => (
              <DateField
                label="Vencimiento"
                value={field.value ? formatDateInput(field.value) : ''}
                onChange={value =>
                  field.onChange(value ? localDateEndToISOString(value) : undefined)
                }
                error={errors.due_at?.message}
              />
            )}
          />
        </SimpleGrid>
        <Text size="xs" c="dimmed" mt={-8}>
          Si dejas Inicio vacío, la tarea comenzará hoy. El vencimiento incluye todo el día
          seleccionado.
        </Text>

        {!initialReference && (
          <>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Select
                label="Tipo de entidad relacionada"
                clearable
                data={TASK_REFERENCE_COLLECTIONS.filter(
                  value => value !== 'compliance-results'
                ).map(value => ({
                  value,
                  label: TASK_REFERENCE_LABELS[value],
                }))}
                value={referenceType}
                onChange={value => {
                  setReferenceType(value as TaskReferenceInput['relationTo'] | null)
                  setValue('related_entity', undefined)
                  setReferenceSearch('')
                  clearErrors('related_entity')
                }}
              />
              {referenceSelect}
            </SimpleGrid>
            {referenceType && (
              <Text size="xs" c="dimmed" mt={-8}>
                {TASK_REFERENCE_HELP[referenceType]}
              </Text>
            )}
          </>
        )}

        {scopeLocked ? (
          <Text size="sm" c="dimmed">
            Alcance: <b>{scopeLabel}</b> (lo define la entidad relacionada)
          </Text>
        ) : (
          <>
            {tenant?.orgWide && (
              <Controller
                name="global"
                control={control}
                render={({ field }) => (
                  <SettingRow
                    label="Alcance"
                    labelId="task-scope"
                    description={
                      field.value
                        ? 'Se aplica una vez a toda la organización.'
                        : 'Se aplica a las oficinas que elijas.'
                    }
                  >
                    <SegmentedControl
                      aria-labelledby="task-scope"
                      data={[
                        { value: 'offices', label: 'Oficinas específicas' },
                        { value: 'global', label: 'Toda la organización' },
                      ]}
                      value={field.value ? 'global' : 'offices'}
                      onChange={value => {
                        field.onChange(value === 'global')
                        if (value === 'global') setValue('office_ids', [])
                      }}
                    />
                  </SettingRow>
                )}
              />
            )}
            {/* Oficinas sólo aplica si el alcance no es toda la organización: se pliega en vez
                de aparecer de golpe al cambiar "Alcance". */}
            <Collapse in={!global}>
              <Stack gap="md">
                <Controller
                  name="office_ids"
                  control={control}
                  render={({ field }) => (
                    <MultiSelect
                      label="Oficinas"
                      required
                      searchable
                      data={[
                        {
                          value: ALL_OFFICES,
                          label: `Todas las oficinas actuales (${officeOptions.length})`,
                        },
                        ...officeOptions,
                      ]}
                      value={field.value}
                      onChange={values =>
                        field.onChange(
                          values.includes(ALL_OFFICES) ? officeOptions.map(o => o.value) : values
                        )
                      }
                      error={errors.office_ids?.message}
                    />
                  )}
                />
                {officeIds.length > 1 && (
                  <Text size="sm" c="dimmed">
                    Se crearán {officeIds.length} tareas independientes.
                  </Text>
                )}
              </Stack>
            </Collapse>
          </>
        )}

        {assignmentOptions.isError && (
          <Alert color="red" title="No se pudieron cargar los destinatarios">
            <Button
              variant="subtle"
              size="compact-sm"
              onClick={() => void assignmentOptions.refetch()}
            >
              Reintentar
            </Button>
          </Alert>
        )}
        <TaskAssignmentFields
          kind={assignmentKind}
          target={(assignmentKind === 'role' ? assignedRole : assignedUser) ?? null}
          options={assignmentOptions.data}
          loading={assignmentOptions.isFetching}
          scopeReady={assignmentScopeReady}
          disabled={create.isPending || assignmentOptions.isError}
          targetError={
            'assigned_role' in errors
              ? errors.assigned_role?.message
              : 'assigned_user' in errors
                ? errors.assigned_user?.message
                : undefined
          }
          onKindChange={kind => {
            setValue('assignment_kind', kind)
            setValue('assigned_role', undefined)
            setValue('assigned_user', undefined)
          }}
          onTargetChange={target =>
            setValue(
              assignmentKind === 'role' ? 'assigned_role' : 'assigned_user',
              target ?? undefined,
              {
                shouldValidate: true,
              }
            )
          }
        />
      </ModalLayout>
    </form>
  )
}
