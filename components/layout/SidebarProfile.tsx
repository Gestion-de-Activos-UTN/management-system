'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar, Group, Menu, Stack, Text, UnstyledButton } from '@mantine/core';
import { ChevronsUpDown, LogOut, Settings } from 'lucide-react';
import { httpClient } from '@/lib/http-client';
import { clearSession, getSession } from '@/lib/session';

/**
 * Account card pinned to the bottom of the sidebar — replaces a bare wordmark
 * with the actual signed-in identity (title/subtitle passed in by the layout,
 * which already has session/tenant-context resolved). Presentation only, no
 * data-fetching of its own.
 */
export function SidebarProfile({ title, subtitle }: { title: string; subtitle?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const accountHref = pathname.startsWith('/portal') ? '/portal/account' : '/account';

  async function handleLogout() {
    // Real server-side logout now that the session is a cookie, not just localStorage —
    // without this the payload-token cookie would outlive the click.
    const session = getSession();
    if (session) {
      await httpClient.post(`/api/${session.collection}/logout`).catch(() => {});
    }
    // Same reason as useLogin's onSuccess: per-user cached queries (tenant-context, lists)
    // must not survive into whoever logs in next on this tab.
    queryClient.clear();
    clearSession();
    router.replace('/login');
  }

  return (
    <Menu position="top-start" width={220} withArrow offset={8}>
      <Menu.Target>
        <UnstyledButton
          p="sm"
          w="100%"
          className="sidebar-profile-trigger"
          style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}
        >
          <Group justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
              <Avatar radius="xl" size={36} color="pine" />
              <Stack gap={0} style={{ minWidth: 0 }}>
                <Text size="sm" fw={600} truncate>
                  {title}
                </Text>
                {subtitle && (
                  <Text size="xs" c="dimmed" truncate>
                    {subtitle}
                  </Text>
                )}
              </Stack>
            </Group>
            <ChevronsUpDown size={16} strokeWidth={1.5} />
          </Group>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<Settings size={18} strokeWidth={1.5} />}
          onClick={() => router.push(accountHref)}
        >
          Account settings
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item leftSection={<LogOut size={18} strokeWidth={1.5} />} onClick={handleLogout}>
          Log out
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
