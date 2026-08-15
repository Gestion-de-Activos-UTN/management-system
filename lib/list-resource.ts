import { httpClient } from './http-client';

export type ListResponse<T> = { docs: T[] };

export function listResource<T>(path: string, params?: Record<string, string | undefined>) {
  return httpClient.get<ListResponse<T>>(path, params).then((r) => r.docs);
}
