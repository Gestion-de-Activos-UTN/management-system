'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Stepper,
  Text,
} from '@mantine/core'
import { Building2, CheckCheck, ClipboardList, Info, Layers3, UserRound } from 'lucide-react'
import type { Office } from '@/app/types/payload-types'
import type { OrgMember } from '@/modules/users/service'
import { MemberSelect } from '@/modules/users/components/MemberSelect'
import type { BulkAssessmentSelector, SaveAssessmentDraft } from '../schema'
import type { BulkAssessmentCompleteResponse, BulkAssessmentPreviewResponse } from '../service'
import { AssessmentForm } from './AssessmentForm'
import type { TenantContext } from '@/modules/auth/hooks/use-tenant-context'
import type { RiskAssetType } from '@/domain/risk/catalog-v2'
import type { AssessmentAnswer } from '@/app/types/payload-types'
import type { EffectiveAnswer } from '@/domain/assessments/evaluateCompliance'

const TYPE_OPTIONS = [
  { value: 'workstation', label: 'Computadoras' },
  { value: 'mobile', label: 'Teléfonos o tablets' },
  { value: 'server', label: 'Servidores' },
  { value: 'gateway', label: 'Routers o gateways' },
  { value: 'network_device', label: 'Switches o puntos de acceso' },
] as const

type ScopeMode = BulkAssessmentSelector['mode']

// Stable references are intentional: AssessmentForm resets when its saved-answer inputs change.
// New []/{} literals on every mutation render would erase the answers after a failed request.
const EMPTY_ANSWERS: AssessmentAnswer[] = []
const EMPTY_EVIDENCE: Record<string, EffectiveAnswer> = {}

export function BulkAssessmentModal({
  opened,
  onClose,
  tenant,
  offices,
  members,
  preview,
  previewing,
  completing,
  onPreview,
  onComplete,
}: {
  opened: boolean
  onClose: () => void
  tenant: TenantContext
  offices: Office[]
  members: OrgMember[]
  preview: BulkAssessmentPreviewResponse | null
  previewing: boolean
  completing: boolean
  onPreview: (selector: BulkAssessmentSelector) => Promise<unknown>
  onComplete: (
    selector: BulkAssessmentSelector,
    assessmentIds: string[],
    signature: string,
    answers: SaveAssessmentDraft
  ) => Promise<BulkAssessmentCompleteResponse>
}) {
  const allowedModes = useMemo(() => {
    if (tenant.role === 'org_admin') return ['owner', 'office', 'organization'] as ScopeMode[]
    if (tenant.role === 'office_manager') return ['owner', 'office'] as ScopeMode[]
    return ['owner'] as ScopeMode[]
  }, [tenant.role])
  const [mode, setMode] = useState<ScopeMode>(allowedModes[0])
  const [riskType, setRiskType] = useState<RiskAssetType | null>(null)
  const [ownerId, setOwnerId] = useState<string | null>(
    tenant.role === 'org_viewer' ? tenant.userId : null
  )
  const [officeId, setOfficeId] = useState<string | null>(null)
  const [selector, setSelector] = useState<BulkAssessmentSelector | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (!opened) return
    setMode(allowedModes[0])
    setRiskType(null)
    setOwnerId(tenant.role === 'org_viewer' ? tenant.userId : null)
    setOfficeId(null)
    setSelector(null)
    setSelected(new Set())
    setStep(0)
  }, [opened, allowedModes, tenant.role, tenant.userId])

  useEffect(() => {
    if (!preview) return
    setSelected(new Set(preview.applicable.map(item => item.assessment_id)))
    setStep(1)
  }, [preview])

  const buildSelector = (): BulkAssessmentSelector | null => {
    if (!riskType) return null
    if (mode === 'owner' && ownerId) return { mode, owner_id: ownerId, risk_asset_type: riskType }
    if (mode === 'office' && officeId)
      return { mode, office_id: officeId, risk_asset_type: riskType }
    if (mode === 'organization') return { mode, risk_asset_type: riskType }
    return null
  }
  const selection = [...selected]
  const tooMany = selection.length > 100
  const canPreview = Boolean(buildSelector())
  const close = () => {
    if (!completing) onClose()
  }

  return (
    <Modal
      opened={opened}
      onClose={close}
      title="Responder varias revisiones"
      size="xl"
      centered
      closeOnClickOutside={!completing}
    >
      <Stack gap="lg">
        <Stepper active={step} size="sm" allowNextStepsSelect={false}>
          <Stepper.Step label="Alcance" icon={<Layers3 size={16} strokeWidth={1.5} />} />
          <Stepper.Step label="Revisiones" icon={<ClipboardList size={16} strokeWidth={1.5} />} />
          <Stepper.Step label="Respuestas" icon={<CheckCheck size={16} strokeWidth={1.5} />} />
        </Stepper>

        {step === 0 && (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Elige una regla para encontrar revisiones abiertas. Antes de responder podrás quitar
              casos puntuales del conjunto.
            </Text>
            <Select
              label="Tipo de activo"
              placeholder="Selecciona un tipo"
              required
              data={[...TYPE_OPTIONS]}
              value={riskType}
              onChange={value => setRiskType(value as RiskAssetType | null)}
            />
            <Select
              label="Agrupar por"
              value={mode}
              onChange={value => setMode((value as ScopeMode) ?? allowedModes[0])}
              data={allowedModes.map(value => ({
                value,
                label:
                  value === 'owner'
                    ? 'Responsable'
                    : value === 'office'
                      ? 'Oficina'
                      : 'Toda la organización',
              }))}
            />
            {mode === 'owner' && (
              <MemberSelect
                label="Responsable"
                placeholder="Selecciona un responsable"
                members={
                  tenant.role === 'org_viewer'
                    ? members.filter(member => member.id === tenant.userId)
                    : members
                }
                value={ownerId}
                onChange={setOwnerId}
                disabled={tenant.role === 'org_viewer'}
                required
              />
            )}
            {mode === 'office' && (
              <Select
                label="Oficina"
                placeholder="Selecciona una oficina"
                data={offices.map(office => ({ value: String(office.id), label: office.name }))}
                value={officeId}
                onChange={setOfficeId}
                required
              />
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={close}>
                Cancelar
              </Button>
              <Button
                color="pine"
                loading={previewing}
                disabled={!canPreview}
                onClick={async () => {
                  const next = buildSelector()
                  if (!next) return
                  setSelector(next)
                  await onPreview(next)
                }}
              >
                Revisar selección
              </Button>
            </Group>
          </Stack>
        )}

        {step === 1 && preview && (
          <Stack gap="md">
            <Alert color="blue" icon={<Info size={16} strokeWidth={1.5} />}>
              Se encontraron {preview.applicable.length} revisiones abiertas. Puedes quitar las que
              no quieras responder ahora.
            </Alert>
            {preview.preserved_completed.length > 0 && (
              <Alert color="gray" icon={<CheckCheck size={16} strokeWidth={1.5} />}>
                {preview.preserved_completed.length}{' '}
                {preview.preserved_completed.length === 1
                  ? 'activo ya tiene una revisión completada'
                  : 'activos ya tienen revisiones completadas'}{' '}
                y no tienen un ciclo abierto. Se mantendrán sin cambios.
              </Alert>
            )}
            {preview.incompatible > 0 && (
              <Alert color="yellow">
                {preview.incompatible} revisiones abiertas usan otro cuestionario y no se incluirán.
              </Alert>
            )}
            <Group justify="space-between">
              <Text fw={700}>
                {selection.length} de {preview.applicable.length} seleccionadas
              </Text>
              <Group gap="xs">
                <Button
                  size="compact-sm"
                  variant="subtle"
                  onClick={() =>
                    setSelected(new Set(preview.applicable.map(item => item.assessment_id)))
                  }
                >
                  Seleccionar todas
                </Button>
                <Button size="compact-sm" variant="subtle" onClick={() => setSelected(new Set())}>
                  Quitar todas
                </Button>
              </Group>
            </Group>
            <ScrollArea.Autosize mah={360} offsetScrollbars>
              <Stack gap="xs">
                {preview.applicable.map(item => {
                  const office = offices.find(candidate => String(candidate.id) === item.office_id)
                  const owner = members.find(candidate => candidate.id === item.owner_id)
                  return (
                    <Card key={item.assessment_id} withBorder radius="md" p="sm">
                      <Checkbox
                        checked={selected.has(item.assessment_id)}
                        onChange={event => {
                          const next = new Set(selected)
                          if (event.currentTarget.checked) next.add(item.assessment_id)
                          else next.delete(item.assessment_id)
                          setSelected(next)
                        }}
                        label={
                          <div>
                            <Text fw={650} size="sm">
                              {item.asset_label}
                            </Text>
                            <Group gap="xs">
                              <Text size="xs" c="dimmed">
                                {office?.name ?? 'Oficina'}
                              </Text>
                              <Text size="xs" c="dimmed">
                                ·
                              </Text>
                              <Text size="xs" c="dimmed">
                                {owner?.name ?? 'Sin responsable'}
                              </Text>
                              <Text size="xs" c={item.has_draft ? 'blue' : 'dimmed'}>
                                · {item.has_draft ? 'Borrador existente' : 'Sin iniciar'}
                              </Text>
                            </Group>
                          </div>
                        }
                      />
                    </Card>
                  )
                })}
              </Stack>
            </ScrollArea.Autosize>
            {tooMany && (
              <Alert color="yellow">
                Puedes completar hasta 100 revisiones por operación. Quita al menos{' '}
                {selection.length - 100}.
              </Alert>
            )}
            <Group justify="space-between">
              <Button variant="default" onClick={() => setStep(0)}>
                Cambiar alcance
              </Button>
              <Button
                color="pine"
                disabled={!selection.length || tooMany || !preview.representative_assessment}
                onClick={() => setStep(2)}
              >
                Responder cuestionario
              </Button>
            </Group>
          </Stack>
        )}

        {step === 2 && preview?.representative_assessment && selector && (
          <Stack gap="md">
            <Group gap="xs">
              {selector.mode === 'owner' ? (
                <UserRound size={18} strokeWidth={1.5} />
              ) : (
                <Building2 size={18} strokeWidth={1.5} />
              )}
              <Text fw={700}>Una respuesta para {selection.length} revisiones</Text>
            </Group>
            <Divider />
            <AssessmentForm
              assessment={preview.representative_assessment}
              savedAnswers={EMPTY_ANSWERS}
              previousAnswers={EMPTY_ANSWERS}
              effectiveEvidence={EMPTY_EVIDENCE}
              readOnly={false}
              saving={false}
              completing={completing}
              showSaveDraft={false}
              completeLabel="Completar revisiones"
              confirmationTitle={`¿Completar ${selection.length} revisiones?`}
              confirmationDescription={`Las respuestas existentes de las ${selection.length} revisiones abiertas serán reemplazadas y todas quedarán completadas.`}
              onSave={() => undefined}
              onComplete={async answers => {
                if (!preview.question_set_signature) return
                try {
                  await onComplete(selector, selection, preview.question_set_signature, answers)
                  onClose()
                } catch {
                  // The mutation hook already shows the API error. Keep this modal and every
                  // selected answer intact so the user can retry without filling the form again.
                }
              }}
            />
            <Button variant="subtle" onClick={() => setStep(1)} disabled={completing}>
              Volver a la selección
            </Button>
          </Stack>
        )}
      </Stack>
    </Modal>
  )
}
