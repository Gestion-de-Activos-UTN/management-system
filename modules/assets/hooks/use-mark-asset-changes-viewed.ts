'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { markAssetChangesViewed } from '../service';

// Mismo patrón que useMarkAssetViewed: side effect silencioso de "entrar al detalle".
export function useMarkAssetChangesViewed(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => markAssetChangesViewed(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}
