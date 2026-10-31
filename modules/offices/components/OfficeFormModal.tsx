'use client'

import { ModalLayout } from '@/components/ui/ModalLayout'
import { textRuleError } from '@/lib/text-rules'
import { userFacingErrorMessage } from '@/lib/user-facing-error'
import { useState } from 'react'
import { Alert, Button, Group, Modal, Select, TextInput } from '@mantine/core'
import { Plus, Save } from 'lucide-react'
import type { Office } from '@/app/types/payload-types'
import { departmentsOf, PROVINCES } from '@/lib/argentina-geo'
import { OfficeInputSchema, type OfficeInput } from '../schema'
import { useSaveOffice } from '../hooks/use-offices'

const PROVINCE_OPTIONS = PROVINCES.map(province => ({ value: province.id, label: province.name }))
type FieldErrors = Partial<Record<keyof OfficeInput, string>>

/** Alta y edición de una oficina: nombre y ubicación (provincia y, opcionalmente, departamento). */
export function OfficeFormModal({
  office,
  opened,
  onClose,
  asOrganization,
}: {
  /** null = oficina nueva. */
  office: Office | null
  opened: boolean
  onClose: () => void
  asOrganization?: string
}) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={office ? 'Editar oficina' : 'Nueva oficina'}
      centered
    >
      {/* key: el formulario arranca de cero con cada oficina que se abre. */}
      <OfficeForm
        key={office ? String(office.id) : 'new'}
        office={office}
        onDone={onClose}
        asOrganization={asOrganization}
      />
    </Modal>
  )
}

function OfficeForm({
  office,
  onDone,
  asOrganization,
}: {
  office: Office | null
  onDone: () => void
  asOrganization?: string
}) {
  const [name, setName] = useState(office?.name ?? '')
  const [provinceId, setProvinceId] = useState(office?.province_id ?? '')
  const [departmentId, setDepartmentId] = useState(office?.department_id ?? '')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [serverError, setServerError] = useState('')
  const save = useSaveOffice(asOrganization)
  const departmentOptions = departmentsOf(provinceId).map(department => ({
    value: department.id,
    label: department.name,
  }))

  const submit = async () => {
    setServerError('')
    const parsed = OfficeInputSchema.safeParse({
      name,
      province_id: provinceId,
      department_id: departmentId || null,
    })
    if (!parsed.success) {
      const next: FieldErrors = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof OfficeInput
        next[field] ??= issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})
    try {
      await save.mutateAsync({ input: parsed.data, id: office ? String(office.id) : undefined })
      onDone()
    } catch (error) {
      setServerError(userFacingErrorMessage(error, 'No se pudo guardar la oficina.'))
    }
  }

  return (
    <ModalLayout
      gap="md"
      footer={
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onDone}>
            Cancelar
          </Button>
          <Button
            loading={save.isPending}
            leftSection={
              office ? <Save size={16} strokeWidth={1.5} /> : <Plus size={16} strokeWidth={1.5} />
            }
            onClick={() => void submit()}
          >
            {office ? 'Guardar cambios' : 'Crear oficina'}
          </Button>
        </Group>
      }
    >
      <TextInput
        label="Nombre de la oficina"
        placeholder="Ej.: Casa central"
        required
        maxLength={120}
        value={name}
        error={errors.name ?? textRuleError(name, 'label')}
        onChange={event => setName(event.currentTarget.value)}
        data-autofocus
      />
      <Select
        label="Provincia"
        placeholder="Selecciona la provincia"
        required
        searchable
        data={PROVINCE_OPTIONS}
        value={provinceId || null}
        error={errors.province_id}
        onChange={value => {
          setProvinceId(value ?? '')
          setDepartmentId('')
        }}
        comboboxProps={{ withinPortal: true }}
      />
      <Select
        label={`${provinceId === '02' ? 'Comuna' : provinceId === '06' ? 'Partido' : 'Departamento'} (opcional)`}
        placeholder={provinceId ? 'Sin especificar' : 'Primero elige la provincia'}
        searchable
        clearable
        disabled={!provinceId}
        data={departmentOptions}
        value={departmentId || null}
        error={errors.department_id}
        onChange={value => setDepartmentId(value ?? '')}
        comboboxProps={{ withinPortal: true }}
      />
      {serverError && <Alert color="red">{serverError}</Alert>}
    </ModalLayout>
  )
}
