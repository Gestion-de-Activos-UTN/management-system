import { Group, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';

/**
 * Repeats identically across every list/detail page (organizations, offices,
 * assets, inventory...) — one place for the title + supporting description
 * pattern instead of a bare `<Title>` floating over the content.
 */
export function PageHeader({
  title,
  description,
  rightSection,
}: {
  title: string;
  description?: string;
  rightSection?: ReactNode;
}) {
  return (
    <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
      <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
        <Title order={2} style={{ lineHeight: 1.1 }}>
          {title}
        </Title>
        {description && (
          <Text c="dimmed" size="sm" maw={700}>
            {description}
          </Text>
        )}
      </Stack>
      {rightSection}
    </Group>
  );
}
