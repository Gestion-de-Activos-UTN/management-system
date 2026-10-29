'use client'

import {
  Alert,
  Button,
  Group,
  Loader,
  Modal,
  Select,
  Stack,
  TextInput,
  Textarea,
} from '@mantine/core'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { Organization } from '@/app/types/payload-types'
import { INDUSTRY_OPTIONS, INDUSTRY_VALUES } from '@/domain/organizations/industry-options'
import { OrganizationDetailsSchema, type OrganizationDetailsInput } from '../schema'
import { useOrganizationDetails, useUpdateOrganizationDetails } from '../hooks/use-organizations'

export function OrganizationEditModal({
  organization,
  onClose,
}: {
  organization: Organization | null
  onClose: () => void
}) {
  const query = useOrganizationDetails(organization ? String(organization.id) : null)
  return (
    <Modal opened={Boolean(organization)} onClose={onClose} title="Editar organización" centered>
      {organization &&
        (query.isPending ? (
          <Loader size="sm" />
        ) : query.isError || !query.data ? (
          <Alert color="red" title="No se pudieron cargar los datos">
            <Button variant="subtle" onClick={() => void query.refetch()}>
              Reintentar
            </Button>
          </Alert>
        ) : (
          <OrganizationEditForm
            key={organization.id}
            id={String(organization.id)}
            initial={query.data}
            onClose={onClose}
          />
        ))}
    </Modal>
  )
}

function OrganizationEditForm({
  id,
  initial,
  onClose,
}: {
  id: string
  initial: { name: string; industry: string; industry_details: string }
  onClose: () => void
}) {
  const save = useUpdateOrganizationDetails()
  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<OrganizationDetailsInput>({
    mode: 'onChange',
    resolver: zodResolver(OrganizationDetailsSchema),
    defaultValues: {
      name: initial.name,
      industry: INDUSTRY_VALUES.find(value => value === initial.industry),
      industry_details: initial.industry_details,
    },
  })
  const industry = watch('industry')
  return (
    <form
      noValidate
      onSubmit={handleSubmit(input => save.mutate({ id, input }, { onSuccess: onClose }))}
    >
      <Stack gap="md">
        <Controller
          name="name"
          control={control}
          render={({ field }) => (
            <TextInput
              {...field}
              label="Nombre de la organización"
              required
              maxLength={200}
              error={errors.name?.message}
            />
          )}
        />
        <Controller
          name="industry"
          control={control}
          render={({ field }) => (
            <Select
              label="Rubro o sector"
              required
              data={[...INDUSTRY_OPTIONS]}
              value={field.value ?? null}
              onChange={value => {
                field.onChange(value)
                if (value !== 'other')
                  setValue('industry_details', '', { shouldDirty: true, shouldValidate: true })
              }}
              error={errors.industry?.message}
            />
          )}
        />
        {industry === 'other' && (
          <Controller
            name="industry_details"
            control={control}
            render={({ field }) => (
              <Textarea
                {...field}
                value={field.value ?? ''}
                label="Detalle del rubro"
                description="Opcional."
                maxLength={300}
                error={errors.industry_details?.message}
              />
            )}
          />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!isDirty}>
            Guardar cambios
          </Button>
        </Group>
      </Stack>
    </form>
  )
}
