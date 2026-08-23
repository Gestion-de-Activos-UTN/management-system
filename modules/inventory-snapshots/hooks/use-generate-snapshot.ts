'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import type { HttpError } from '@/lib/http-client';
import { generateSnapshot } from '../service';

// Invalida solo ['inventory-snapshots'] — nunca ['assets']/['non-network-assets']: generar un
// snapshot es una LECTURA de esas colecciones en un instante, no las modifica.
export function useGenerateSnapshot() {
  const queryClient = useQueryClient();
  return useMutation<unknown, HttpError, string>({
    mutationFn: (officeId) => generateSnapshot(officeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-snapshots'] });
      notifications.show({ color: 'green', message: 'Snapshot generated' });
    },
    onError: (error) => {
      notifications.show({ color: 'red', message: error.message ?? 'Could not generate the snapshot' });
    },
  });
}
