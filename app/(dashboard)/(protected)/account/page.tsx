'use client';

import { Card, Stack, Text, TextInput } from '@mantine/core';
import { PageHeader } from '@/components/ui/PageHeader';
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context';

export default function AccountPage() {
  const { data: tenantContext } = useTenantContext();

  return (
    <Stack gap="md">
      <PageHeader title="Account settings" />
      <Card withBorder padding="lg" w="100%" maw={420}>
        <Stack gap="sm">
          <TextInput label="Role" value={tenantContext?.role ?? ''} readOnly />
          <Text size="xs" c="dimmed">
            Read-only preview — editing ships with the mutation phase.
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
}
