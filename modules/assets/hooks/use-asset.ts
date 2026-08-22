'use client';

import { useQuery } from '@tanstack/react-query';
import { getAsset } from '../service';

export function useAsset(id: string) {
  return useQuery({ queryKey: ['assets', id], queryFn: () => getAsset(id), enabled: !!id });
}
