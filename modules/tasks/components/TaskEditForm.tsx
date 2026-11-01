'use client'

import { ModalLayout } from '@/components/ui/ModalLayout'
import { DateField } from '@/components/ui/DateField'
import { type FormEvent } from 'react'
import { useSingleSubmission } from '@/components/ui/use-single-submission'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button, Group, Select, SimpleGrid, TextInput } from '@mantine/core'
import { CharacterCountTextarea } from '@/components/ui/CharacterCountTextarea'
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
  const submission = useSingleSubmission()
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditTaskInput>({
    mode: 'onChange',
    resolver: zodResolver(EditTaskSchema),
    defaultValues: {
      title: task.title,
      description: task.description ?? '',
      priority: task.priority,
      start_at: task.start_at,
      due_at: task.due_at ?? null,
    },
  })
  const validateAndSubmit = handleSubmit(async values => {
    try {
      await edit.mutateAsync(values)
    } catch {
      // The mutation reports the error; keep the entered values available for retry.
      return
    }
    submission.succeed()
    onSaved()
  })
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    return submission.run(() => validateAndSubmit(event))
  }
  return (
    <form noValidate onSubmit={submit}>
      <ModalLayout
        gap="md"
        footer={
          <Group justify="flex-end">
            <Button
              type="submit"
              loading={isSubmitting || edit.isPending}
              disabled={submission.submitted}
            >
              Guardar
            </Button>
          </Group>
        }
      >
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
            <CharacterCountTextarea
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
                withAsterisk
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
                onChange={value => field.onChange(value ? localDateEndToISOString(value) : null)}
                error={errors.due_at?.message}
              />
            )}
          />
        </SimpleGrid>
      </ModalLayout>
    </form>
  )
}
