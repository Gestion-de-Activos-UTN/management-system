'use client';

import { useQuery } from '@tanstack/react-query';
import { useUiStore } from '@/lib/ui-store';
import { listAssets } from '../service';

// Reads Zustand's selectedOfficeId into the query key/params so switching offices in the
// TopBar (OfficeSelector) triggers a real refetch — the one narrow, intentional case where
// a query hook reads Zustand as an input; it never writes a query result back into it.
// selectedOfficeId is a single global slot shared by both portals' browser sessions — fine
// in practice since the admin portal never renders OfficeSelector to set it, but if that
// ever changes, namespace the store key per portal.
export function useAssetsList(asOrganization?: string) {
  const selectedOfficeId = useUiStore((s) => s.selectedOfficeId);
  return useQuery({
    queryKey: ['assets', asOrganization, selectedOfficeId],
    queryFn: () => listAssets({ asOrganization, officeId: selectedOfficeId }),
  });
}
