import { Card, Stack, Text } from '@mantine/core'
import { Building2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'

export default function AdminHomePage() {
  return (
    <Stack gap="md">
      <PageHeader
        title="SIAM — Administración de plataforma"
        description="Estructura de solo lectura; las modificaciones estarán disponibles más adelante."
      />
      <Card withBorder padding="xl">
        <Stack align="center" gap="xs" py="xl">
          <Building2 size={32} strokeWidth={1.5} />
          <Text c="dimmed">Ve a Organizaciones para ver o visitar una organización.</Text>
        </Stack>
      </Card>
    </Stack>
  )
}
