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
  CreateTasksSchema,
  TASK_REFERENCE_COLLECTIONS,
  type CreateTasksInput,
  type TaskReferenceInput,
} from '../schema'
import { TASK_REFERENCE_LABELS } from '../task-labels'
import { useCreateTasks } from '../hooks/use-task-actions'
import { useTaskAssignmentOptions, useTaskReferenceOptions } from '../hooks/use-task-options'

const ALL_OFFICES = '__all_offices__'

function localDateTimeValue(iso?: string): string {
  const date = iso ? new Date(iso) : new Date()
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function inputDateToIso(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined
}

export function TaskForm({
  asOrganization,
  initialReference,
  onSaved,
}: {
  asOrganization?: string
  initialReference?: TaskReferenceInput
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
    formState: { errors },
  } = useForm<CreateTasksInput>({
    resolver: zodResolver(CreateTasksSchema),
    defaultValues: {
      title: '',
      description: '',
      priority: 'normal',
      start_at: new Date().toISOString(),
      due_at: undefined,
      global: true,
      office_ids: [],
      assignment_kind: 'open_pool',
      related_entity: initialReference,
    },
  })
  const global = watch('global')
  const officeIds = watch('office_ids')
  const assignmentKind = watch('assignment_kind')
  const reference = watch('related_entity')
  const referenceOptions = useTaskReferenceOptions(
    referenceType,
    null,
    asOrganization,
    initialReference?.value
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

  const officeOptions = (offices ?? []).map(office => ({
    value: String(office.id),
    label: office.name,
  }))
  const scopeLocked = Boolean(reference)

  const submit = handleSubmit(values => {
    create.mutate(values, { onSuccess: onSaved })
  })

  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="md">
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
                type="datetime-local"
                label="Inicio"
                description="Vacío usa la fecha actual"
                value={field.value ? localDateTimeValue(field.value) : ''}
                onChange={event => field.onChange(inputDateToIso(event.currentTarget.value))}
                error={errors.start_at?.message}
              />
            )}
          />
          <Controller
            name="due_at"
            control={control}
            render={({ field }) => (
              <TextInput
                type="datetime-local"
                label="Vencimiento"
                value={field.value ? localDateTimeValue(field.value) : ''}
                onChange={event => field.onChange(inputDateToIso(event.currentTarget.value))}
                error={errors.due_at?.message}
              />
            )}
          />
        </SimpleGrid>

        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label="Tipo de entidad relacionada"
            clearable={!initialReference}
            disabled={Boolean(initialReference)}
            data={TASK_REFERENCE_COLLECTIONS.map(value => ({
              value,
              label: TASK_REFERENCE_LABELS[value],
            }))}
            value={referenceType}
            onChange={value => {
              setReferenceType(value as TaskReferenceInput['relationTo'] | null)
              setValue('related_entity', undefined)
            }}
          />
          <Controller
            name="related_entity"
            control={control}
            render={({ field }) => (
              <Select
                label="Entidad relacionada"
                placeholder={referenceType ? 'Selecciona una entidad' : 'Sin relación'}
                disabled={!referenceType || Boolean(initialReference)}
                searchable
                clearable={!initialReference}
                data={(referenceOptions.data ?? []).map(option => ({
                  value: option.value,
                  label: option.label,
                }))}
                value={field.value?.value ?? null}
                onChange={value =>
                  field.onChange(
                    value && referenceType ? { relationTo: referenceType, value } : undefined
                  )
                }
              />
            )}
          />
        </SimpleGrid>

        <Controller
          name="global"
          control={control}
          render={({ field }) => (
            <Switch
              label="Tarea global"
              description="Se aplica una vez a toda la organización"
              checked={field.value}
              disabled={scopeLocked}
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
                disabled={scopeLocked}
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

        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Controller
            name="assignment_kind"
            control={control}
            render={({ field }) => (
              <Select
                label="Asignación"
                data={[
                  { value: 'open_pool', label: 'Pool abierto' },
                  { value: 'role', label: 'Rol' },
                  { value: 'user', label: 'Usuario' },
                ]}
                value={field.value}
                onChange={value => {
                  field.onChange(value ?? 'open_pool')
                  setValue('assigned_role', undefined)
                  setValue('assigned_user', undefined)
                }}
              />
            )}
          />
          {assignmentKind === 'role' && (
            <Controller
              name="assigned_role"
              control={control}
              render={({ field }) => (
                <Select
                  label="Rol asignado"
                  required
                  data={(assignmentOptions.data?.roles ?? []).map(role => ({
                    value: role.id,
                    label: role.slug,
                  }))}
                  value={field.value ?? null}
                  onChange={field.onChange}
                  error={'assigned_role' in errors ? errors.assigned_role?.message : undefined}
                />
              )}
            />
          )}
          {assignmentKind === 'user' && (
            <Controller
              name="assigned_user"
              control={control}
              render={({ field }) => (
                <Select
                  label="Usuario asignado"
                  required
                  searchable
                  data={(assignmentOptions.data?.users ?? []).map(user => ({
                    value: user.id,
                    label: user.name || user.email,
                  }))}
                  value={field.value ?? null}
                  onChange={field.onChange}
                  error={'assigned_user' in errors ? errors.assigned_user?.message : undefined}
                />
              )}
            />
          )}
        </SimpleGrid>
        <Group justify="flex-end">
          <Button type="submit" loading={create.isPending}>
            {officeIds.length > 1 ? `Crear ${officeIds.length} tareas` : 'Crear tarea'}
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
