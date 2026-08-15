'use client';

import { Card, Skeleton, Stack, Text, TextInput } from '@mantine/core';
import { PageHeader } from '@/components/ui/PageHeader';
import { useFakeLoading } from '@/lib/use-fake-loading';

// ponytail: static placeholder — OrganizationSettings has no read-only GET wired up yet;
// build this once that endpoint (or mutation support) ships.
export default function AdminSettingsPage() {
  const loading = useFakeLoading();

  return (
    <Stack gap="md">
      <PageHeader title="Settings" description="Organization-level settings." />
      <Card withBorder padding="lg" maw={480}>
        {loading ? (
          <Stack gap="sm">
            <Skeleton height={36} />
            <Skeleton height={36} />
          </Stack>
        ) : (
          <Stack gap="sm">
            <TextInput label="Industry" value="Healthcare" readOnly />
            <TextInput label="Risk score policy" value="Default" readOnly />
            <Text size="xs" c="dimmed">
              Read-only preview — editing ships with the mutation phase.
            </Text>
          </Stack>
        )}
      </Card>
    </Stack>
  );
}
