'use client';

import { ActionIcon, useMantineColorScheme, useComputedColorScheme } from '@mantine/core';
import { Sun, Moon } from 'lucide-react';

export function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('light', { getInitialValueInEffect: true });

  return (
    <ActionIcon
      variant="default"
      size={36}
      aria-label="Toggle color scheme"
      onClick={() => setColorScheme(computed === 'light' ? 'dark' : 'light')}
    >
      {computed === 'light' ? (
        <Moon size={20} strokeWidth={1.5} />
      ) : (
        <Sun size={20} strokeWidth={1.5} />
      )}
    </ActionIcon>
  );
}
