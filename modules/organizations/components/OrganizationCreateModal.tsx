'use client'

import { useState } from 'react'
import {
  Badge,
  Alert,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  PasswordInput,
  Select,
  Stack,
  Tabs,
  Textarea,
  Text,
  TextInput,
} from '@mantine/core'
import { Building2, ClipboardCheck, MapPin, ShieldCheck, UsersRound } from 'lucide-react'
import { departmentsOf, PROVINCES } from '@/lib/argentina-geo'
import { textRuleError } from '@/lib/text-rules'
import { OrganizationCreateSchema, type OrganizationCreateInput } from '../schema'
import { ROLE_DESCRIPTIONS } from '@/modules/users/member-labels'
import { INDUSTRY_OPTIONS } from '@/domain/organizations/industry-options'

type FormField =
  | 'name'
  | 'industry'
  | 'industry_details'
  | 'plan'
  | 'officeName'
  | 'provinceId'
  | 'departmentId'
  | 'adminName'
  | 'adminEmail'
  | 'adminPassword'

const ISSUE_FIELDS: Record<string, { field: FormField; step: number }> = {
  name: { field: 'name', step: 0 },
  industry: { field: 'industry', step: 0 },
  industry_details: { field: 'industry_details', step: 0 },
  plan: { field: 'plan', step: 0 },
  'first_office.name': { field: 'officeName', step: 1 },
  'first_office.province_id': { field: 'provinceId', step: 1 },
  'first_office.department_id': { field: 'departmentId', step: 1 },
  'first_admin.name': { field: 'adminName', step: 2 },
  'first_admin.email': { field: 'adminEmail', step: 2 },
  'first_admin.password': { field: 'adminPassword', step: 2 },
}

const STEP_FIELDS: Record<number, FormField[]> = {
  0: ['name', 'industry', 'industry_details', 'plan'],
  1: ['officeName', 'provinceId', 'departmentId'],
  2: ['adminName', 'adminEmail', 'adminPassword'],
  3: [],
}

export function OrganizationCreateModal({
  opened,
  onClose,
  onSubmit,
  isPending,
}: {
  opened: boolean
  onClose: () => void
  onSubmit: (input: OrganizationCreateInput) => Promise<unknown>
  isPending: boolean
}) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [industry, setIndustry] = useState<string | null>(null)
  const [industryDetails, setIndustryDetails] = useState('')
  const [plan, setPlan] = useState<string | null>('basic')
  const [officeName, setOfficeName] = useState('')
  const [provinceId, setProvinceId] = useState<string | null>(null)
  const [departmentId, setDepartmentId] = useState<string | null>(null)
  const [adminName, setAdminName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FormField, string>>>({})
  const reset = () => {
    setStep(0)
    setName('')
    setIndustry(null)
    setIndustryDetails('')
    setPlan('basic')
    setOfficeName('')
    setProvinceId(null)
    setDepartmentId(null)
    setAdminName('')
    setAdminEmail('')
    setAdminPassword('')
    setError('')
    setFieldErrors({})
    onClose()
  }
  const draft = (): unknown => ({
    name,
    industry,
    ...(industry === 'other' && industryDetails.trim()
      ? { industry_details: industryDetails }
      : {}),
    plan,
    first_office: { name: officeName, province_id: provinceId, department_id: departmentId },
    first_admin: { name: adminName, email: adminEmail, password: adminPassword },
  })
  const goToStep = (target: number) => {
    setError('')
    setStep(target)
  }
  const clearFieldError = (field: FormField) => {
    setFieldErrors(current => {
      const { [field]: _, ...rest } = current
      return rest
    })
  }
  const tabError = (index: number) =>
    STEP_FIELDS[index].some(field => fieldErrors[field]) ? (
      <Box w={8} h={8} bg="red.6" style={{ borderRadius: '50%' }} aria-label="Con errores" />
    ) : null
  const next = () => goToStep(Math.min(3, step + 1))
  const review = OrganizationCreateSchema.safeParse(draft())
  const reviewIssues = review.success ? [] : review.error.issues
  const reviewValue = (value: string | null | undefined) => value?.trim() || 'Sin completar'
  const submit = () => {
    const parsed = OrganizationCreateSchema.safeParse(draft())
    if (!parsed.success) {
      const errors: Partial<Record<FormField, string>> = {}
      let firstStep: number | null = null
      const unmapped: string[] = []
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.')
        const target = ISSUE_FIELDS[key]
        if (!target) {
          unmapped.push(issue.message)
          continue
        }
        if (!errors[target.field]) {
          errors[target.field] =
            issue.code === 'invalid_value' && target.field === 'industry'
              ? 'Selecciona un rubro.'
              : issue.code === 'invalid_value' && target.field === 'plan'
                ? 'Selecciona un plan.'
                : issue.message
          firstStep ??= target.step
        }
      }
      setFieldErrors(errors)
      if (firstStep !== null) setStep(firstStep)
      setError(unmapped[0] ?? '')
      return
    }
    setError('')
    setFieldErrors({})
    void onSubmit(parsed.data)
      .then(reset)
      .catch(() => {
        // El hook presenta el error; se conservan los datos para corregir o reintentar.
      })
  }

  return (
    <Modal opened={opened} onClose={reset} title="Crear organización" size="lg" centered>
      <Stack>
        <Tabs value={String(step)} onChange={value => value && goToStep(Number(value))}>
          <Tabs.List grow>
            <Tabs.Tab
              value="0"
              leftSection={<Building2 size={16} strokeWidth={1.5} />}
              rightSection={tabError(0)}
            >
              Organización
            </Tabs.Tab>
            <Tabs.Tab
              value="1"
              leftSection={<MapPin size={16} strokeWidth={1.5} />}
              rightSection={tabError(1)}
            >
              Oficina
            </Tabs.Tab>
            <Tabs.Tab
              value="2"
              leftSection={<UsersRound size={16} strokeWidth={1.5} />}
              rightSection={tabError(2)}
            >
              Administrador
            </Tabs.Tab>
            <Tabs.Tab value="3" leftSection={<ClipboardCheck size={16} strokeWidth={1.5} />}>
              Revisar
            </Tabs.Tab>
          </Tabs.List>
          {error && (
            <Alert color="red" mt="md">
              {error}
            </Alert>
          )}
          <Tabs.Panel value="0" pt="md">
            <Stack>
              <TextInput
                label="Nombre de la organización"
                value={name}
                error={fieldErrors.name ?? textRuleError(name.trim(), 'label')}
                onChange={event => {
                  setName(event.currentTarget.value)
                  clearFieldError('name')
                }}
                maxLength={200}
                required
              />
              <Select
                label="Rubro o sector"
                description="Selecciona la actividad principal. Si no aparece, elige Otro."
                placeholder="Selecciona un rubro"
                data={INDUSTRY_OPTIONS.map(option => ({
                  value: option.value,
                  label: option.label,
                }))}
                searchable
                value={industry}
                error={fieldErrors.industry}
                onChange={value => {
                  setIndustry(value)
                  clearFieldError('industry')
                  if (value !== 'other') {
                    setIndustryDetails('')
                    clearFieldError('industry_details')
                  }
                }}
                required
              />
              {industry === 'other' && (
                <Textarea
                  label="¿A qué se dedica la organización?"
                  description="Opcional. Este contexto puede servir a futuras funciones de IA."
                  placeholder="Describe brevemente su actividad"
                  value={industryDetails}
                  error={fieldErrors.industry_details ?? textRuleError(industryDetails, 'free')}
                  onChange={event => {
                    setIndustryDetails(event.currentTarget.value)
                    clearFieldError('industry_details')
                  }}
                  maxLength={300}
                  autosize
                  minRows={2}
                  maxRows={4}
                />
              )}
              <Select
                label="Plan inicial"
                data={[
                  { value: 'basic', label: 'Basic' },
                  { value: 'premium', label: 'Premium' },
                ]}
                value={plan}
                error={fieldErrors.plan}
                onChange={value => {
                  setPlan(value)
                  clearFieldError('plan')
                }}
                required
              />
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="1" pt="md">
            <Stack>
              <TextInput
                label="Nombre de la primera oficina"
                placeholder="Ej.: Casa central"
                value={officeName}
                error={fieldErrors.officeName ?? textRuleError(officeName.trim(), 'label')}
                onChange={event => {
                  setOfficeName(event.currentTarget.value)
                  clearFieldError('officeName')
                }}
                maxLength={120}
                required
              />
              <Select
                label="Provincia"
                searchable
                data={PROVINCES.map(item => ({ value: item.id, label: item.name }))}
                value={provinceId}
                error={fieldErrors.provinceId}
                onChange={value => {
                  setProvinceId(value)
                  setDepartmentId(null)
                  clearFieldError('provinceId')
                  clearFieldError('departmentId')
                }}
                required
              />
              <Select
                label={`${provinceId === '02' ? 'Comuna' : provinceId === '06' ? 'Partido' : 'Departamento'} (opcional)`}
                placeholder={provinceId ? 'Sin especificar' : 'Primero elige la provincia'}
                searchable
                clearable
                data={departmentsOf(provinceId).map(item => ({ value: item.id, label: item.name }))}
                value={departmentId}
                error={fieldErrors.departmentId}
                onChange={value => {
                  setDepartmentId(value)
                  clearFieldError('departmentId')
                }}
                disabled={!provinceId}
              />
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="2" pt="md">
            <Stack>
              <TextInput
                label="Nombre y apellido"
                value={adminName}
                error={fieldErrors.adminName ?? textRuleError(adminName.trim(), 'personName')}
                onChange={event => {
                  setAdminName(event.currentTarget.value)
                  clearFieldError('adminName')
                }}
                maxLength={120}
                required
              />
              <TextInput
                label="Correo"
                type="email"
                value={adminEmail}
                error={fieldErrors.adminEmail}
                onChange={event => {
                  setAdminEmail(event.currentTarget.value)
                  clearFieldError('adminEmail')
                }}
                required
              />
              <PasswordInput
                label="Contraseña inicial"
                description="La cuenta quedará activa inmediatamente. Mínimo 8 caracteres."
                value={adminPassword}
                error={fieldErrors.adminPassword}
                onChange={event => {
                  setAdminPassword(event.currentTarget.value)
                  clearFieldError('adminPassword')
                }}
                minLength={8}
                maxLength={128}
                required
              />
              <FixedRoleCard />
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="3" pt="md">
            <Stack gap="sm">
              <div>
                <Text fw={650}>Revisá los datos</Text>
                <Text size="sm" c="dimmed">
                  La organización y su cuenta inicial se crearán juntas.
                </Text>
              </div>
              {reviewIssues.length > 0 && (
                <Alert color="yellow" title="Revisión incompleta">
                  <Text size="sm">
                    Faltan datos obligatorios. Completa los pasos pendientes antes de crear la
                    organización.
                  </Text>
                </Alert>
              )}
              <Card withBorder radius="md" p="md">
                <Group gap="sm" wrap="nowrap" align="flex-start">
                  <Building2 size={18} strokeWidth={1.5} />
                  <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
                    <Text size="sm" fw={600}>
                      Organización
                    </Text>
                    <Text size="sm">{reviewValue(name)}</Text>
                    <Text size="xs" c="dimmed">
                      Rubro o sector:{' '}
                      {INDUSTRY_OPTIONS.find(option => option.value === industry)?.label ??
                        'Sin completar'}
                      {industryDetails.trim() ? ` · ${industryDetails.trim()}` : ''}
                    </Text>
                    <Group gap="xs" mt={4}>
                      <Text size="xs" c="dimmed">
                        Plan inicial
                      </Text>
                      <Badge color="pine" variant="light">
                        {plan === 'premium'
                          ? 'Premium'
                          : plan === 'basic'
                            ? 'Basic'
                            : 'Sin completar'}
                      </Badge>
                    </Group>
                  </Stack>
                </Group>
                <Divider my="sm" />
                <Group gap="sm" wrap="nowrap" align="flex-start">
                  <MapPin size={18} strokeWidth={1.5} />
                  <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
                    <Text size="sm" fw={600}>
                      Primera oficina
                    </Text>
                    <Text size="sm">{reviewValue(officeName)}</Text>
                    <Text size="xs" c="dimmed">
                      {PROVINCES.find(item => item.id === provinceId)?.name ??
                        'Provincia sin completar'}
                      {departmentId
                        ? ` · ${departmentsOf(provinceId).find(item => item.id === departmentId)?.name}`
                        : ''}
                    </Text>
                  </Stack>
                </Group>
                <Divider my="sm" />
                <Group gap="sm" wrap="nowrap" align="flex-start">
                  <UsersRound size={18} strokeWidth={1.5} />
                  <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
                    <Text size="sm" fw={600}>
                      Cuenta inicial
                    </Text>
                    <Text size="sm">{reviewValue(adminName)}</Text>
                    <Text size="xs" c="dimmed">
                      {reviewValue(adminEmail)}
                    </Text>
                    <Text size="xs" c="dimmed">
                      Contraseña inicial: {adminPassword ? 'configurada' : 'Sin completar'}
                    </Text>
                    <Group gap={6} mt={4}>
                      <ShieldCheck size={15} strokeWidth={1.5} />
                      <Text size="xs" fw={600}>
                        Administrador de la organización
                      </Text>
                    </Group>
                  </Stack>
                </Group>
              </Card>
            </Stack>
          </Tabs.Panel>
        </Tabs>
        <Group justify="space-between">
          <Button variant="default" onClick={step ? () => goToStep(step - 1) : reset}>
            {step ? 'Anterior' : 'Cancelar'}
          </Button>
          {step < 3 ? (
            <Button onClick={next}>Siguiente</Button>
          ) : (
            <Button loading={isPending} onClick={submit}>
              Crear organización
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  )
}

function FixedRoleCard() {
  return (
    <Card withBorder radius="md" p="md">
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <ShieldCheck size={20} strokeWidth={1.5} />
        <Stack gap={3} style={{ minWidth: 0 }}>
          <Group gap="xs">
            <Text size="sm" fw={650}>
              Administrador de la organización
            </Text>
            <Badge size="sm" variant="light" color="pine">
              Rol fijo
            </Badge>
          </Group>
          <Text size="xs" c="dimmed">
            {ROLE_DESCRIPTIONS.org_admin}
          </Text>
        </Stack>
      </Group>
    </Card>
  )
}
