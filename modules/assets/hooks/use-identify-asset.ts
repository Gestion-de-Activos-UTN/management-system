'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import type { HttpError } from '@/lib/http-client';
import { identifyAsset } from '../service';

export function useIdentifyAsset() {
  const queryClient = useQueryClient();
  return useMutation<unknown, HttpError, { id: string; identified: boolean }>({
    mutationFn: ({ id, identified }) => identifyAsset(id, identified),
    onSuccess: (_, { identified }) => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      notifications.show({ color: 'green', message: identified ? 'Asset identified' : 'Asset marked as not identified' });
    },
    onError: (error) => {
      notifications.show({ color: 'red', message: error.message ?? 'Could not update identification status' });
    },
  });
}
