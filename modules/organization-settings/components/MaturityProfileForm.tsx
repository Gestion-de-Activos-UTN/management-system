'use client'

import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Button, Group, Radio, Stack, Text } from '@mantine/core'
import { maturityLevel, type MaturityLevel } from '@/domain/organizations/maturity'
import { formatDateTime } from '@/lib/format-date'
import { OrganizationMaturitySchema, type OrganizationMaturityValues } from '../schema'

const LEVEL_TEXT: Record<MaturityLevel, { name: string; detail: string }> = {
  initial: {
    name: 'Inicial',
    detail:
      'Las recomendaciones priorizan ajustes sin costo, con herramientas que la empresa ya tiene.',
  },
  managed: {
    name: 'Gestionado',
    detail:
      'Las recomendaciones incluyen reglas simples, revisiones periódicas y alguna compra puntual.',
  },
  advanced: {
    name: 'Avanzado',
    detail:
      'Las recomendaciones pueden incluir herramientas centralizadas y servicios administrados.',
  },
}

/** Two plain questions; the level is derived, never typed in by the user. */
export function MaturityProfileForm({
  initial,
  updatedAt,
  onSave,
  saving,
}: {
  initial: Partial<OrganizationMaturityValues>
  updatedAt?: string | null
  onSave: (values: OrganizationMaturityValues) => void
  saving: boolean
}) {
  const { control, handleSubmit, watch } = useForm<OrganizationMaturityValues>({
    resolver: zodResolver(OrganizationMaturitySchema),
    defaultValues: initial,
  })
  const level = maturityLevel(watch('maturity_it_owner'), watch('maturity_security_budget'))

  return (
    <form onSubmit={handleSubmit(onSave)} noValidate>
      <Stack gap="md">
        <div>
          <Text fw={700}>Perfil de la organización</Text>
          <Text size="sm" c="dimmed">
            Nos ayuda a sugerir primero las mejoras que tu empresa puede aplicar hoy. No cambia el
            puntaje de riesgo.
          </Text>
        </div>
        <Controller
          name="maturity_it_owner"
          control={control}
          render={({ field, fieldState }) => (
            <Radio.Group
              label="¿Hay alguien en la empresa que se ocupe de las computadoras, los sistemas o la seguridad, aunque no sea su única tarea?"
              value={field.value ?? null}
              onChange={field.onChange}
              error={fieldState.error && 'Elige una opción'}
            >
              <Group mt="xs">
                <Radio value="yes" label="Sí" />
                <Radio value="no" label="No" />
              </Group>
            </Radio.Group>
          )}
        />
        <Controller
          name="maturity_security_budget"
          control={control}
          render={({ field, fieldState }) => (
            <Radio.Group
              label="¿La empresa destina dinero a herramientas o servicios de seguridad? Por ejemplo: antivirus pago, copias en la nube o soporte técnico."
              value={field.value ?? null}
              onChange={field.onChange}
              error={fieldState.error && 'Elige una opción'}
            >
              <Stack gap="xs" mt="xs">
                <Radio value="none" label="No" />
                <Radio value="occasional" label="A veces, para compras puntuales" />
                <Radio value="recurring" label="Sí, de forma regular" />
              </Stack>
            </Radio.Group>
          )}
        />
        {level ? (
          <Alert color="pine" variant="light" title={`Nivel: ${LEVEL_TEXT[level].name}`}>
            {LEVEL_TEXT[level].detail}
          </Alert>
        ) : (
          <Text size="sm" c="dimmed">
            Responde las dos preguntas para ver el nivel de tu organización.
          </Text>
        )}
        <Group justify="space-between" wrap="wrap">
          <Text size="xs" c="dimmed">
            {updatedAt
              ? `Última actualización: ${formatDateTime(updatedAt)}. Actualizalo si la empresa suma personal de sistemas o presupuesto.`
              : 'Todavía no se completó.'}
          </Text>
          <Button type="submit" loading={saving} w={{ base: '100%', sm: 'auto' }}>
            Guardar perfil
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
