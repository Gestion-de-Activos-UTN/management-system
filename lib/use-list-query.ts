import { useQuery } from '@tanstack/react-query';

export function useListQuery<T>(key: string, fn: () => Promise<T>, extraDeps: unknown[] = []) {
  return useQuery({ queryKey: [key, ...extraDeps], queryFn: fn });
}
