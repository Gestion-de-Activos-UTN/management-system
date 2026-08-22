'use client';

import { useQuery } from '@tanstack/react-query';
import { getSnapshot } from '../service';

export function useSnapshot(id: string) {
  return useQuery({ queryKey: ['inventory-snapshots', id], queryFn: () => getSnapshot(id), enabled: !!id });
}
