'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { markAssetViewed } from '../service';

// Silencioso a propósito — es un side effect de "entrar al detalle", no una acción que el
// usuario disparó ni algo que necesite confirmar con un toast. Misma invalidación por prefijo
// que useUpdateAsset, para que la fila en /portal/inventory pierda el badge "NEW" sin esperar
// el staleTime de 30s (lib/query-client.ts) al volver a la lista.
export function useMarkAssetViewed(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => markAssetViewed(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
}
