'use client'

import { useCallback, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Center, Loader, Stack } from '@mantine/core'
import { BackButton } from '@/components/ui/BackButton'
import { PageHeader } from '@/components/ui/PageHeader'
import { portalHref } from '@/lib/portal-href'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'
import { useOrgMembers } from '@/modules/users/hooks/use-org-members'
import { useOfficesList } from '@/modules/offices/hooks/use-offices'
import { useBulkAssessments } from '@/modules/assessments/hooks/use-bulk-assessments'
import { useBulkAssessmentStore } from '@/modules/assessments/assessments.store'
import {
  BulkAssessmentWizard,
  type BulkStep,
} from '@/modules/assessments/components/BulkAssessmentWizard'
import { canUseBulkAssessments } from '@/modules/assessments/assessment-labels'

export default function BulkAssessmentPage() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const asOrganization = params.get('asOrganization') ?? undefined
  const rawStep = Number(params.get('step'))
  const step: BulkStep = rawStep === 1 || rawStep === 2 ? rawStep : 0
  const tenant = useTenantContext(asOrganization)
  const members = useOrgMembers(asOrganization)
  const offices = useOfficesList(asOrganization)
  const bulk = useBulkAssessments()
  const resetStore = useBulkAssessmentStore(state => state.reset)
  const listHref = portalHref('/portal/security-review', asOrganization)
  const allowed = canUseBulkAssessments(tenant.data)

  useEffect(() => {
    if (tenant.data && !allowed) router.replace(listHref)
  }, [tenant.data, allowed, listHref, router])

  // Las respuestas del cuestionario no se guardan: avisar antes de cerrar o recargar la pestaña.
  useEffect(() => {
    if (step !== 2) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [step])

  // Cada paso es una entrada del historial: "atrás" del navegador retrocede un paso.
  const changeStep = useCallback(
    (next: BulkStep, options?: { replace?: boolean }) => {
      const href = portalHref(pathname, asOrganization, next ? `step=${next}` : undefined)
      if (options?.replace) router.replace(href, { scroll: false })
      else router.push(href)
    },
    [pathname, asOrganization, router]
  )

  if (!tenant.data || !allowed) {
    return (
      <Center py="xl">
        <Loader color="pine" />
      </Center>
    )
  }

  return (
    <Stack gap="lg">
      <BackButton href={listHref} label="Volver a Revisión de seguridad" />
      <PageHeader
        title="Responder varias revisiones"
        description="Una sola respuesta completa todas las revisiones abiertas que elijas. Sirve para equipos que se usan y protegen de la misma forma."
      />
      <BulkAssessmentWizard
        step={step}
        onStepChange={changeStep}
        selectionHref={portalHref(pathname, asOrganization, 'step=1')}
        onCancel={() => {
          resetStore()
          router.push(listHref)
        }}
        onDone={() => router.push(listHref)}
        tenant={tenant.data}
        offices={offices.data ?? []}
        members={members.data ?? []}
        preview={bulk.preview.data ?? null}
        previewing={bulk.preview.isPending}
        completing={bulk.complete.isPending}
        onPreview={selector => bulk.preview.mutateAsync(selector)}
        onComplete={(selector, assessmentIds, signature, answers) =>
          bulk.complete.mutateAsync({
            selector,
            assessment_ids: assessmentIds,
            question_set_signature: signature,
            answers: answers.answers,
          })
        }
      />
    </Stack>
  )
}
