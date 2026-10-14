'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Group, Select, SimpleGrid, Stack, Textarea, TextInput } from '@mantine/core'
import type { TaskDTO } from '../service'
import { EditTaskSchema, type EditTaskInput } from '../schema'
import { useEditTask } from '../hooks/use-task-actions'
import {
  formatDateInput,
  localDateEndToISOString,
  localDateStartToISOString,
} from '@/lib/format-date'

export function TaskEditForm({ task, onSaved }: { task: TaskDTO; onSaved: () => void }) {
  const edit = useEditTask(task.id)
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<EditTaskInput>({
    resolver: zodResolver(EditTaskSchema),
    defaultValues: {
      title: task.title,
      description: task.description ?? '',
      priority: task.priority,
      start_at: task.start_at,
      due_at: task.due_at ?? null,
    },
  })
  return (
    <form noValidate onSubmit={handleSubmit(values => edit.mutate(values, { onSuccess: onSaved }))}>
      <Stack gap="md">
        <Controller
          name="title"
          control={control}
          render={({ field }) => (
            <TextInput
              label="Título"
              required
              maxLength={160}
              {...field}
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
              minRows={3}
              autosize
              maxLength={5000}
              {...field}
              value={field.value ?? ''}
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
                onChange={field.onChange}
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
                      : null
                  )
                }
                error={errors.due_at?.message}
              />
            )}
          />
        </SimpleGrid>
        <Group justify="flex-end">
          <Button type="submit" loading={edit.isPending}>
            Guardar
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
