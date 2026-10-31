'use client'

import { matchesSearch } from '@/lib/search-text'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Divider,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Stepper,
  Text,
  TextInput,
} from '@mantine/core'
import {
  Building2,
  CheckCheck,
  ClipboardList,
  Info,
  Layers3,
  Search,
  UserRound,
} from 'lucide-react'
import type { Office } from '@/app/types/payload-types'
import type { OrgMember } from '@/modules/users/service'
import { MemberSelect } from '@/modules/users/components/MemberSelect'
import { DataTable } from '@/components/ui/DataTable'
import { FilterBar } from '@/components/ui/FilterBar'
import type { BulkAssessmentSelector, SaveAssessmentDraft } from '../schema'
import type { BulkAssessmentCompleteResponse, BulkAssessmentPreviewResponse } from '../service'
import { getBulkSelectionColumns } from '../assessments.columns'
import { useBulkAssessmentStore } from '../assessments.store'
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

const MAX_BULK = 100

type ScopeMode = BulkAssessmentSelector['mode']
export type BulkStep = 0 | 1 | 2

// Stable references are intentional: AssessmentForm resets when its saved-answer inputs change.
// New []/{} literals on every mutation render would erase the answers after a failed request.
const EMPTY_ANSWERS: AssessmentAnswer[] = []
const EMPTY_EVIDENCE: Record<string, EffectiveAnswer> = {}

/**
 * "Responder varias": alcance → selección → cuestionario único. El paso vive en la URL (lo
 * maneja la página) para que "atrás" del navegador retroceda un paso; alcance y selección viven
 * en useBulkAssessmentStore para sobrevivir a una recarga.
 */
export function BulkAssessmentWizard({
  step,
  onStepChange,
  selectionHref,
  onCancel,
  onDone,
  tenant,
  offices,
  members,
  preview,
  previewing,
  completing,
  onPreview,
  onComplete,
}: {
  step: BulkStep
  onStepChange: (step: BulkStep, options?: { replace?: boolean }) => void
  /** URL del paso de selección: el pie del cuestionario vuelve ahí (misma fila que Completar). */
  selectionHref: string
  onCancel: () => void
  onDone: () => void
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
  const store = useBulkAssessmentStore()
  const selector = store.selector
  const [mode, setMode] = useState<ScopeMode>(selector?.mode ?? allowedModes[0])
  const [riskType, setRiskType] = useState<RiskAssetType | null>(
    (selector?.risk_asset_type as RiskAssetType | undefined) ?? null
  )
  const [ownerId, setOwnerId] = useState<string | null>(
    tenant.role === 'org_viewer'
      ? tenant.userId
      : selector?.mode === 'owner'
        ? selector.owner_id
        : null
  )
  const [officeId, setOfficeId] = useState<string | null>(
    selector?.mode === 'office' ? selector.office_id : null
  )
  const [search, setSearch] = useState('')
  const selected = useMemo(() => new Set(store.selected), [store.selected])

  // Recarga en un paso posterior: la vista previa (servidor) no se guarda, se vuelve a pedir con
  // el alcance guardado. Sin alcance guardado no hay nada que mostrar → vuelta al paso 1.
  const restoring = useRef(false)
  useEffect(() => {
    if (step === 0 || preview || previewing || restoring.current) return
    if (!selector) {
      onStepChange(0, { replace: true })
      return
    }
    restoring.current = true
    onPreview(selector).catch(() => onStepChange(0, { replace: true }))
  }, [step, preview, previewing, selector, onPreview, onStepChange])

  // La selección guardada sólo conserva revisiones que siguen abiertas en la vista previa nueva.
  useEffect(() => {
    if (!preview) return
    const applicable = preview.applicable.map(item => item.assessment_id)
    const kept = store.selected.filter(id => applicable.includes(id))
    store.setSelected(kept.length ? kept : applicable)
  }, [preview]) // eslint-disable-line react-hooks/exhaustive-deps

  const buildSelector = (): BulkAssessmentSelector | null => {
    if (!riskType) return null
    if (mode === 'owner' && ownerId) return { mode, owner_id: ownerId, risk_asset_type: riskType }
    if (mode === 'office' && officeId)
      return { mode, office_id: officeId, risk_asset_type: riskType }
    if (mode === 'organization') return { mode, risk_asset_type: riskType }
    return null
  }
  const selection = store.selected
  const tooMany = selection.length > MAX_BULK
  const candidates = (preview?.applicable ?? []).filter(item =>
    matchesSearch([item.asset_label], search)
  )
  const visibleIds = candidates.map(item => item.assessment_id)
  const columns = getBulkSelectionColumns({
    selected,
    visibleIds,
    onToggle: (id, checked) =>
      store.setSelected(checked ? [...selection, id] : selection.filter(item => item !== id)),
    onToggleAll: checked =>
      store.setSelected(
        checked
          ? [...new Set([...selection, ...visibleIds])]
          : selection.filter(id => !visibleIds.includes(id))
      ),
    officeName: id => offices.find(office => String(office.id) === id)?.name ?? 'Oficina',
    ownerName: id => members.find(member => member.id === id)?.name ?? 'Sin responsable',
  })

  return (
    <Stack gap="lg">
      <Stepper active={step} size="sm" allowNextStepsSelect={false}>
        <Stepper.Step label="Alcance" icon={<Layers3 size={16} strokeWidth={1.5} />} />
        <Stepper.Step label="Revisiones" icon={<ClipboardList size={16} strokeWidth={1.5} />} />
        <Stepper.Step label="Respuestas" icon={<CheckCheck size={16} strokeWidth={1.5} />} />
      </Stepper>

      {step === 0 && (
        <Card withBorder radius="lg" p="lg">
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Elige una regla para encontrar revisiones abiertas.
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
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
            </SimpleGrid>
            <Group justify="flex-end">
              <Button variant="default" onClick={onCancel}>
                Cancelar
              </Button>
              <Button
                color="pine"
                loading={previewing}
                disabled={!buildSelector()}
                onClick={async () => {
                  const next = buildSelector()
                  if (!next) return
                  // Alcance nuevo → selección nueva (el efecto de `preview` la completa).
                  store.setSelector(next)
                  store.setSelected([])
                  await onPreview(next)
                  onStepChange(1)
                }}
              >
                Revisar selección
              </Button>
            </Group>
          </Stack>
        </Card>
      )}

      {step === 1 && preview && (
        <Stack gap="md">
          <Alert color="blue" icon={<Info size={16} strokeWidth={1.5} />}>
            Se encontraron {preview.applicable.length} revisiones abiertas.
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
          <FilterBar>
            <TextInput
              placeholder="Buscar activo"
              aria-label="Buscar activo"
              leftSection={<Search size={16} strokeWidth={1.5} />}
              value={search}
              onChange={event => setSearch(event.currentTarget.value)}
              w="100%"
            />
          </FilterBar>
          <DataTable
            columns={columns}
            data={candidates}
            emptyLabel="Ninguna revisión coincide con la búsqueda"
            minWidth={640}
          />
          {tooMany && (
            <Alert color="yellow">
              Puedes completar hasta {MAX_BULK} revisiones por operación. Quita al menos{' '}
              {selection.length - MAX_BULK}.
            </Alert>
          )}
          <Group justify="space-between">
            <Button variant="default" onClick={() => onStepChange(0)}>
              Cambiar alcance
            </Button>
            <Group gap="sm">
              <Text size="sm" fw={600}>
                {selection.length} de {preview.applicable.length} seleccionadas
              </Text>
              <Button
                color="pine"
                disabled={!selection.length || tooMany || !preview.representative_assessment}
                onClick={() => onStepChange(2)}
              >
                Responder cuestionario
              </Button>
            </Group>
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
            backHref={selectionHref}
            backLabel="Volver a la selección"
            onSave={() => undefined}
            onComplete={async answers => {
              if (!preview.question_set_signature) return
              try {
                await onComplete(selector, selection, preview.question_set_signature, answers)
                store.reset()
                onDone()
              } catch {
                // The mutation hook already shows the API error. Keep the page and every
                // selected answer intact so the user can retry without filling the form again.
              }
            }}
          />
        </Stack>
      )}
    </Stack>
  )
}
