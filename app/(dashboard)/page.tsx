import {
  Stack,
  Title,
  Text,
  Group,
  Button,
  Card,
  Divider,
  TextInput,
} from '@mantine/core';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';

const TONES: StatusTone[] = ['success', 'warning', 'danger', 'info', 'neutral'];

export default function DashboardHome() {
  return (
    <Stack gap="xl" maw={720}>
      <Stack gap={4}>
        <Title order={2}>SIAM</Title>
        <Text c="dimmed">
          Dashboard shell online — domain pages ship per module (see
          STYLEGUIDE.md). This preview exists only to verify the theme and
          base components; delete once real modules exist.
        </Text>
      </Stack>

      <Divider label="Buttons" labelPosition="left" />
      <Group>
        <Button>Primary</Button>
        <Button variant="light">Light</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="subtle">Subtle</Button>
        <Button variant="default">Default</Button>
      </Group>

      <Divider label="Status badges" labelPosition="left" />
      <Group>
        {TONES.map((tone) => (
          <StatusBadge key={tone} tone={tone} label={tone} />
        ))}
      </Group>

      <Divider label="Card + form field" labelPosition="left" />
      <Card withBorder radius="md" padding="lg" maw={360}>
        <Stack gap="sm">
          <Text fw={600}>Example card</Text>
          <TextInput label="Alias" placeholder="e.g. prod-db-01" />
          <Group justify="flex-end">
            <Button size="sm">Save</Button>
          </Group>
        </Stack>
      </Card>
    </Stack>
  );
}
