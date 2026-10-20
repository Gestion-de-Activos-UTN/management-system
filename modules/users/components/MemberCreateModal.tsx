'use client'

import { useState } from 'react'
import {
  Alert,
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
import { TEXT_RULES } from '@/lib/text-rules'

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
  const [error, setError] = useState('')
  const chosenRole = lockedRole ?? role

  const close = () => {
    setName('')
    setEmail('')
    setPassword('')
    setOfficeIds([])
    setRole(lockedRole ?? roles[0] ?? 'org_viewer')
    setError('')
    onClose()
  }

  const submit = async () => {
    const parsed = MemberCreateSchema.safeParse({
      name,
      email,
      password,
      role: chosenRole,
      office_ids: chosenRole === 'org_admin' ? [] : officeIds,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Revisa los datos ingresados.')
      return
    }
    if (chosenRole !== 'org_admin' && !officeIds.length) {
      setError('Asigna al menos una oficina activa.')
      return
    }
    setError('')
    try {
      await onSubmit(parsed.data)
      close()
    } catch {
      // El hook presenta el error de API; se conserva el formulario para corregir/reintentar.
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
      <Stack>
        {error && <Alert color="red">{error}</Alert>}
        <TextInput
          label="Nombre y apellido"
          value={name}
          onChange={event => setName(event.currentTarget.value)}
          error={
            name
              ? !TEXT_RULES.personName[0].test(name.trim())
                ? TEXT_RULES.personName[1]
                : undefined
              : undefined
          }
          maxLength={120}
          required
        />
        <TextInput
          label="Correo"
          type="email"
          value={email}
          onChange={event => setEmail(event.currentTarget.value)}
          required
        />
        <PasswordInput
          label="Contraseña inicial"
          description="La cuenta quedará activa al crearla. Mínimo 8 caracteres."
          value={password}
          onChange={event => setPassword(event.currentTarget.value)}
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
            onChange={value => value && setRole(value)}
            required
          />
        )}
        {chosenRole !== 'org_admin' && (
          <MultiSelect
            label="Oficinas"
            description="La persona sólo tendrá acceso a estas oficinas."
            data={officeOptions}
            value={officeIds}
            onChange={setOfficeIds}
            searchable
            required
          />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={close}>
            Cancelar
          </Button>
          <Button loading={isPending} onClick={submit}>
            Crear
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
