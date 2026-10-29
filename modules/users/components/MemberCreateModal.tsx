'use client'

import { useState } from 'react'
import {
  Button,
  Group,
  Modal,
  MultiSelect,
  PasswordInput,
  Select,
  Stack,
  TextInput,
  Text,
} from '@mantine/core'
import { MemberCreateSchema, ORGANIZATION_ROLES, type MemberCreate } from '../schema'
import { ROLE_LABELS } from '@/lib/role-labels'
import type { HttpError } from '@/lib/http-client'
import { userFacingErrorMessage } from '@/lib/user-facing-error'

type Props = {
  opened: boolean
  onClose: () => void
  officeOptions: Array<{ value: string; label: string }>
  roles: readonly (typeof ORGANIZATION_ROLES)[number][]
  lockedRole?: (typeof ORGANIZATION_ROLES)[number]
  onSubmit: (input: MemberCreate) => Promise<unknown>
  isPending: boolean
}

export function MemberCreateModal({
  opened,
  onClose,
  officeOptions,
  roles,
  lockedRole,
  onSubmit,
  isPending,
}: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<string>(lockedRole ?? roles[0] ?? 'org_viewer')
  const [officeIds, setOfficeIds] = useState<string[]>([])
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof MemberCreate, string>>>({})
  const chosenRole = lockedRole ?? role

  const validateField = (field: keyof MemberCreate, value: unknown) => {
    const parsed = MemberCreateSchema.shape[field].safeParse(value)
    const message =
      field === 'office_ids' && chosenRole !== 'org_admin' && Array.isArray(value) && !value.length
        ? 'Selecciona al menos una oficina activa.'
        : parsed.success
          ? undefined
          : parsed.error.issues[0]?.message
    setFieldErrors(current => ({ ...current, [field]: message }))
  }

  const close = () => {
    setName('')
    setEmail('')
    setPassword('')
    setOfficeIds([])
    setRole(lockedRole ?? roles[0] ?? 'org_viewer')
    setFieldErrors({})
    onClose()
  }

  const submit = async () => {
    if (isPending) return
    const parsed = MemberCreateSchema.safeParse({
      name,
      email,
      password,
      role: chosenRole,
      office_ids: chosenRole === 'org_admin' ? [] : officeIds,
    })
    const errors: Partial<Record<keyof MemberCreate, string>> = {}
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof MemberCreate
        errors[field] ??= issue.message
      }
    if (chosenRole !== 'org_admin' && !officeIds.length)
      errors.office_ids = 'Selecciona al menos una oficina activa.'
    setFieldErrors(errors)
    if (!parsed.success || Object.keys(errors).length) return
    try {
      await onSubmit(parsed.data)
      close()
    } catch (error) {
      if ((error as Partial<HttpError>)?.code === 'email_unavailable') {
        setFieldErrors(current => ({
          ...current,
          email: userFacingErrorMessage(error, 'Escribe otro correo.'),
        }))
      }
      // Los errores generales los presenta el hook; se conserva el formulario.
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={close}
      title={
        lockedRole === 'org_admin' ? 'Añadir administrador de la organización' : 'Crear persona'
      }
      centered
    >
      <form
        noValidate
        onSubmit={event => {
          event.preventDefault()
          void submit()
        }}
      >
        <Stack>
          <TextInput
            label="Nombre y apellido"
            value={name}
            onChange={event => {
              setName(event.currentTarget.value)
              validateField('name', event.currentTarget.value)
            }}
            error={fieldErrors.name}
            maxLength={120}
            required
          />
          <TextInput
            label="Correo"
            type="email"
            value={email}
            onChange={event => {
              setEmail(event.currentTarget.value)
              validateField('email', event.currentTarget.value)
            }}
            error={fieldErrors.email}
            required
          />
          <PasswordInput
            label="Contraseña inicial"
            description="La cuenta quedará activa al crearla. Mínimo 8 caracteres."
            value={password}
            onChange={event => {
              setPassword(event.currentTarget.value)
              validateField('password', event.currentTarget.value)
            }}
            error={fieldErrors.password}
            minLength={8}
            maxLength={128}
            required
          />
          {lockedRole ? (
            <Stack gap={2}>
              <Text size="sm" fw={500}>
                Rol
              </Text>
              <Text size="sm" c="dimmed">
                {ROLE_LABELS[lockedRole]}
              </Text>
            </Stack>
          ) : (
            <Select
              label="Rol"
              data={roles.map(value => ({ value, label: ROLE_LABELS[value] }))}
              value={role}
              onChange={value => {
                if (!value) return
                setRole(value)
                validateField('role', value)
                if (value === 'org_admin')
                  setFieldErrors(current => ({ ...current, office_ids: undefined }))
              }}
              error={fieldErrors.role}
              required
            />
          )}
          {chosenRole !== 'org_admin' && (
            <MultiSelect
              label="Oficinas"
              description="La persona sólo tendrá acceso a estas oficinas."
              data={officeOptions}
              value={officeIds}
              onChange={value => {
                setOfficeIds(value)
                validateField('office_ids', value)
              }}
              error={fieldErrors.office_ids}
              searchable
              required
            />
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              Cancelar
            </Button>
            <Button loading={isPending} type="submit">
              Crear
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  )
}
