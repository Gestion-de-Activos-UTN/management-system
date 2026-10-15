'use client'

import { Collapse, Select, SimpleGrid, Stack, TextInput, Textarea } from '@mantine/core'
import { Controller, type Control, type FieldErrors, type Path } from 'react-hook-form'
import type { z } from 'zod'
import type { AssessmentScopeFieldsSchema } from '@/domain/assessments/assessment-scope-schema'
import { ASSESSMENT_EXCLUSION_REASON_OPTIONS } from '@/lib/enum-labels'
import { formatDateInput, localDateEndToISOString } from '@/lib/format-date'

type ScopeFields = z.infer<typeof AssessmentScopeFieldsSchema>

/**
 * Motivo, fecha límite y nota de una exclusión de la revisión de seguridad. Los usan el detalle
 * de un activo de red y el formulario de activos manuales (mismos campos y reglas:
 * domain/assessments/assessment-scope-schema.ts). El selector de alcance queda en cada
 * formulario porque su onChange difiere. Se pliegan en vez de aparecer de golpe.
 */
export function AssessmentExclusionFields<T extends ScopeFields>({
  control,
  errors,
  excluded,
  noteRequired,
}: {
  control: Control<T>
  errors: FieldErrors<T>
  excluded: boolean
  noteRequired: boolean
}) {
  const fieldErrors = errors as FieldErrors<ScopeFields>
  return (
    <Collapse in={excluded}>
      <Stack gap="md">
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <Controller
            name={'assessment_exclusion_reason' as Path<T>}
            control={control}
            render={({ field }) => (
              <Select
                label="Motivo de exclusión"
                required
                data={[...ASSESSMENT_EXCLUSION_REASON_OPTIONS]}
                value={(field.value as string | null) ?? null}
                onChange={field.onChange}
                error={fieldErrors.assessment_exclusion_reason?.message}
              />
            )}
          />
          <Controller
            name={'assessment_excluded_until' as Path<T>}
            control={control}
            render={({ field }) => (
              <TextInput
                type="date"
                label="Excluido hasta"
                description="Fecha obligatoria, hasta 90 días desde hoy."
                required
                error={fieldErrors.assessment_excluded_until?.message}
                value={field.value ? formatDateInput(field.value as string) : ''}
                onChange={event =>
                  field.onChange(
                    event.currentTarget.value
                      ? localDateEndToISOString(event.currentTarget.value)
                      : null
                  )
                }
              />
            )}
          />
        </SimpleGrid>
        <Controller
          name={'assessment_exclusion_note' as Path<T>}
          control={control}
          render={({ field }) => (
            <Textarea
              label="Nota de exclusión"
              description="Agrega contexto para quienes revisen cuando sea útil."
              required={noteRequired}
              value={(field.value as string | null) ?? ''}
              onChange={field.onChange}
              error={fieldErrors.assessment_exclusion_note?.message}
            />
          )}
        />
      </Stack>
    </Collapse>
  )
}
