import { Stack, Text, Title } from '@mantine/core';

/**
 * Repeats identically across every list/detail page (organizations, offices,
 * assets, inventory...) — one place for the title + supporting description
 * pattern instead of a bare `<Title>` floating over the content.
 */
export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <Stack gap={4}>
      <Title order={2}>{title}</Title>
      {description && (
        <Text c="dimmed" size="sm">
          {description}
        </Text>
      )}
    </Stack>
  );
}
