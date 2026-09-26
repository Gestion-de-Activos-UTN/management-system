'use client'

import { Card, Stack, Text, TextInput } from '@mantine/core'
import { PageHeader } from '@/components/ui/PageHeader'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'

export default function AccountPage() {
  const { data: tenantContext } = useTenantContext()

  return (
    <Stack gap="md">
      <PageHeader title="Configuración de la cuenta" />
      <Card withBorder padding="lg" w="100%" maw={420}>
        <Stack gap="sm">
          <TextInput label="Rol" value={tenantContext?.role ?? ''} readOnly />
          <Text size="xs" c="dimmed">
            Vista de solo lectura; la edición estará disponible en una próxima etapa.
          </Text>
        </Stack>
      </Card>
    </Stack>
  )
}
