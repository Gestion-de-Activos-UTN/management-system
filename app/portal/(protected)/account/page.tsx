'use client'

import { useSearchParams } from 'next/navigation'
import { Card, Stack, Text, TextInput } from '@mantine/core'
import { PageHeader } from '@/components/ui/PageHeader'
import { useTenantContext, isEffectiveOrgAdmin } from '@/modules/auth/hooks/use-tenant-context'

export default function AccountPage() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const { data: tenantContext } = useTenantContext(asOrganization)
  // A platform admin visiting an org sees this exactly as an org_admin would — the
  // backend keeps the true `role: platform_admin` for audit purposes, this is display-only.
  const displayRole = isEffectiveOrgAdmin(tenantContext) ? 'org_admin' : (tenantContext?.role ?? '')

  return (
    <Stack gap="md">
      <PageHeader title="Configuración de la cuenta" />
      <Card withBorder padding="lg" w="100%" maw={420}>
        <Stack gap="sm">
          <TextInput label="Rol" value={displayRole} readOnly />
          <Text size="xs" c="dimmed">
            Vista de solo lectura; la edición estará disponible en una próxima etapa.
          </Text>
        </Stack>
      </Card>
    </Stack>
  )
}
