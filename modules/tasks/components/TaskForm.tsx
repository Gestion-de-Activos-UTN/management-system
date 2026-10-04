'use client'

import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Button,
  Group,
  MultiSelect,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core'
import { useOfficesList } from '@/modules/offices/hooks/use-offices'
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
    formState: { errors },
  } = useForm<CreateTasksInput>({
    resolver: zodResolver(CreateTasksSchema),
    defaultValues: {
      title: '',
      description: '',
      priority: 'normal',
      start_at: undefined,
      due_at: undefined,
      global: true,
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
  const referenceOptions = useTaskReferenceOptions(
    referenceType,
    null,
    asOrganization,
    referenceLocked ? initialReference?.value : undefined
  )
  const assignmentOptions = useTaskAssignmentOptions(officeIds, reference, asOrganization)

  const selectedReference = useMemo(
    () => referenceOptions.data?.find(option => option.value === reference?.value),
    [referenceOptions.data, reference]
  )

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
            initialReference ? TASK_REFERENCE_HELP[initialReference.relationTo] : undefined
          }
          required={Boolean(referenceType)}
          placeholder={referenceType ? 'Selecciona una entidad' : 'Sin relación'}
          disabled={!referenceType}
          searchable
          clearable={!initialReference}
          nothingFoundMessage="Sin resultados"
          error={errors.related_entity?.message}
          data={(referenceOptions.data ?? []).map(option => ({
            value: option.value,
            label: option.label,
          }))}
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

  const submit = handleSubmit(values => {
    // Elegir un tipo sin entidad crearía la tarea sin vínculo, en silencio. Se exige completar
    // la entidad o quitar el tipo.
    if (referenceType && !values.related_entity) {
      setError('related_entity', { message: 'Selecciona una entidad.' })
      return
    }
    create.mutate(values, { onSuccess: onSaved })
  })

  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="md">
        {referenceLocked && initialReference && (
          <TaskReferenceSummary
            relationTo={initialReference.relationTo}
            label={selectedReference?.label ?? (referenceOptions.isPending ? 'Cargando…' : null)}
          />
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
            <Textarea
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
              <TextInput
                type="date"
                label="Inicio"
                value={field.value ? formatDateInput(field.value) : ''}
                onChange={event =>
                  field.onChange(
                    event.currentTarget.value
                      ? localDateStartToISOString(event.currentTarget.value)
                      : undefined
                  )
                }
                error={errors.start_at?.message}
              />
            )}
          />
          <Controller
            name="due_at"
            control={control}
            render={({ field }) => (
              <TextInput
                type="date"
                label="Vencimiento"
                value={field.value ? formatDateInput(field.value) : ''}
                onChange={event =>
                  field.onChange(
                    event.currentTarget.value
                      ? localDateEndToISOString(event.currentTarget.value)
                      : undefined
                  )
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
                data={TASK_REFERENCE_COLLECTIONS.map(value => ({
                  value,
                  label: TASK_REFERENCE_LABELS[value],
                }))}
                value={referenceType}
                onChange={value => {
                  setReferenceType(value as TaskReferenceInput['relationTo'] | null)
                  setValue('related_entity', undefined)
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
            <Controller
              name="global"
              control={control}
              render={({ field }) => (
                <Switch
                  label="Tarea global"
                  description="Se aplica una vez a toda la organización"
                  checked={field.value}
                  onChange={event => {
                    field.onChange(event.currentTarget.checked)
                    if (event.currentTarget.checked) setValue('office_ids', [])
                  }}
                />
              )}
            />
            {!global && (
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
            )}
            {!global && officeIds.length > 1 && (
              <Text size="sm" c="dimmed">
                Se crearán {officeIds.length} tareas independientes.
              </Text>
            )}
          </>
        )}

        <TaskAssignmentFields
          kind={assignmentKind}
          target={(assignmentKind === 'role' ? assignedRole : assignedUser) ?? null}
          options={assignmentOptions.data}
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
        <Group justify="flex-end">
          <Button type="submit" loading={create.isPending}>
            {officeIds.length > 1 ? `Crear ${officeIds.length} tareas` : 'Crear tarea'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
