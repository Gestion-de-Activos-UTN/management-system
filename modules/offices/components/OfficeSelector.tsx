'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Select, Skeleton } from '@mantine/core';
import { useUiStore } from '@/lib/ui-store';
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context';
import { useOfficesList } from '../hooks/use-offices';

const ALL_OFFICES = '__all__';

/**
 * Cross-cutting office filter, not a nav destination — lives in the TopBar (see
 * app/portal/(protected)/layout.tsx). Selection is stored in Zustand's ui-store (persisted
 * across sessions/orgs) and read from there by modules/assets/hooks/use-assets.ts's queryKey.
 * `null` means "All Offices" (no filter) — the default whenever there's more than one office;
 * with exactly one office, that office is selected automatically since there's no real choice
 * to make. If the persisted selection doesn't belong to the current org (e.g. platform_admin
 * switched ?asOrganization=), the default is re-applied instead of keeping the stale id.
 */
export function OfficeSelector() {
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined;
  const { data: tenantContext, isPending: tenantContextPending } = useTenantContext(asOrganization);
  const { data: offices, isPending: officesPending } = useOfficesList(asOrganization);
  const selectedOfficeId = useUiStore((s) => s.selectedOfficeId);
  const setSelectedOfficeId = useUiStore((s) => s.setSelectedOfficeId);
  const officeIds = tenantContext?.officeIds ?? [];

  useEffect(() => {
    if (tenantContextPending) return; // officeIds is [] while loading, not "this org has zero offices"
    // selectedOfficeId is persisted across sessions/orgs (lib/ui-store.ts) — if it no longer
    // belongs to the current org's offices (e.g. platform_admin switched ?asOrganization=),
    // re-apply the default instead of keeping a stale/foreign office id selected.
    if (selectedOfficeId !== null && !officeIds.includes(selectedOfficeId)) {
      setSelectedOfficeId(officeIds.length === 1 ? officeIds[0] : null);
      return;
    }
    if (selectedOfficeId === null && officeIds.length === 1) {
      setSelectedOfficeId(officeIds[0]);
    }
  }, [tenantContextPending, selectedOfficeId, officeIds, setSelectedOfficeId]);

  // Fixed-size skeleton instead of `null` while the offices list is still in flight —
  // the parent layout already blocks on tenant-context before mounting this at all, but
  // this query is separate and would otherwise pop the selector in a beat late, shifting
  // the whole TopBar's width.
  if (officesPending) {
    return <Skeleton height={34} width={200} radius="sm" />;
  }

  const options = [
    ...(officeIds.length > 1 ? [{ value: ALL_OFFICES, label: 'All Offices' }] : []),
    ...(offices ?? [])
      .filter((office) => officeIds.includes(String(office.id)))
      .map((office) => ({ value: String(office.id), label: office.name })),
  ];

  if (options.length === 0) return null;

  return (
    <Select
      placeholder="Office"
      data={options}
      value={selectedOfficeId ?? ALL_OFFICES}
      onChange={(value) => setSelectedOfficeId(value === ALL_OFFICES ? null : value)}
      w={200}
      size="sm"
    />
  );
}
