import { Group, Text, Burger } from '@mantine/core';
import type { ReactNode } from 'react';
import { ColorSchemeToggle } from '@/components/ui/ColorSchemeToggle';

export function TopBar({
  opened,
  onToggle,
  rightSection,
}: {
  opened: boolean;
  onToggle: () => void;
  rightSection?: ReactNode;
}) {
  return (
    <Group h="100%" px="md" justify="space-between">
      <Group gap="sm">
        <Burger opened={opened} onClick={onToggle} hiddenFrom="sm" size="sm" />
        <Text fw={600} size="lg">
          SIAM
        </Text>
      </Group>
      <Group gap="sm">
        {rightSection}
        <ColorSchemeToggle />
      </Group>
    </Group>
  );
}
