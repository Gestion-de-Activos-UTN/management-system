import { Card, Stack, Text } from '@mantine/core';
import { Building2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';

export default function AdminHomePage() {
  return (
    <Stack gap="md">
      <PageHeader title="SIAM — Platform Admin" description="Read-only skeleton — mutations ship later." />
      <Card withBorder padding="xl">
        <Stack align="center" gap="xs" py="xl">
          <Building2 size={32} strokeWidth={1.5} />
          <Text c="dimmed">Head to Organizations to view or visit a tenant.</Text>
        </Stack>
      </Card>
    </Stack>
  );
}
