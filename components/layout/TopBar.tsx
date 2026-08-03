import { Group, Text, Burger } from '@mantine/core';
import { ColorSchemeToggle } from '@/components/ui/ColorSchemeToggle';

export function TopBar({
  opened,
  onToggle,
}: {
  opened: boolean;
  onToggle: () => void;
}) {
  return (
    <Group h="100%" px="md" justify="space-between">
      <Group gap="sm">
        <Burger opened={opened} onClick={onToggle} hiddenFrom="sm" size="sm" />
        <Text fw={600} size="lg">
          SIAM
        </Text>
      </Group>
      <ColorSchemeToggle />
    </Group>
  );
}
