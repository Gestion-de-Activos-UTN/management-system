'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Box, Select, Skeleton, Tooltip } from '@mantine/core'
import { useUiStore } from '@/lib/ui-store'
import { useTenantContext } from '@/modules/auth/hooks/use-tenant-context'
import { useOfficesList } from '../hooks/use-offices'

const ALL_OFFICES = '__all__'

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
  const asOrganization = useSearchParams().get('asOrganization') ?? undefined
  const { data: tenantContext, isPending: tenantContextPending } = useTenantContext(asOrganization)
  const { data: offices, isPending: officesPending } = useOfficesList(asOrganization)
  const selectedOfficeId = useUiStore(s => s.selectedOfficeId)
  const setSelectedOfficeId = useUiStore(s => s.setSelectedOfficeId)
  const officeIds = tenantContext?.officeIds ?? []
  const inputRef = useRef<HTMLInputElement>(null)
  const [dropdownOpened, setDropdownOpened] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const pointerFocus = useRef(false)
  const [truncated, setTruncated] = useState(false)

  useEffect(() => {
    if (tenantContextPending) return // officeIds is [] while loading, not "this org has zero offices"
    // selectedOfficeId is persisted across sessions/orgs (lib/ui-store.ts) — if it no longer
    // belongs to the current org's offices (e.g. platform_admin switched ?asOrganization=),
    // re-apply the default instead of keeping a stale/foreign office id selected.
    if (selectedOfficeId !== null && !officeIds.includes(selectedOfficeId)) {
      setSelectedOfficeId(officeIds.length === 1 ? officeIds[0] : null)
      return
    }
    if (selectedOfficeId === null && officeIds.length === 1) {
      setSelectedOfficeId(officeIds[0])
    }
  }, [tenantContextPending, selectedOfficeId, officeIds, setSelectedOfficeId])

  const options = [
    ...(officeIds.length > 1 ? [{ value: ALL_OFFICES, label: 'Todas las oficinas' }] : []),
    ...(offices ?? [])
      .filter(office => officeIds.includes(String(office.id)))
      .map(office => ({ value: String(office.id), label: office.name })),
  ]

  const selectedLabel =
    options.find(option => option.value === (selectedOfficeId ?? ALL_OFFICES))?.label ??
    options[0]?.label ??
    ''

  const measureLabel = useCallback(() => {
    const input = inputRef.current
    if (!input) return
    const style = getComputedStyle(input)
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return
    context.font = style.font
    const available =
      input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    setTruncated(context.measureText(selectedLabel).width > available)
  }, [selectedLabel])

  useEffect(() => {
    measureLabel()
    const input = inputRef.current
    if (!input) return
    const observer = new ResizeObserver(measureLabel)
    observer.observe(input)
    return () => observer.disconnect()
  }, [measureLabel, officesPending])

  if (officesPending) return <Skeleton height={34} width={200} radius="sm" />
  if (options.length === 0) return null

  return (
    <Tooltip label={selectedLabel} opened={!dropdownOpened && truncated && (hovered || focused)}>
      <Box
        onMouseEnter={() => {
          measureLabel()
          setHovered(true)
        }}
        onMouseLeave={() => setHovered(false)}
        // A click keeps the input focused through the whole pick, so pointer focus must not reveal
        // the full name; only keyboard focus does (inputs always match :focus-visible in Chrome).
        onPointerDownCapture={() => {
          pointerFocus.current = true
        }}
        onFocusCapture={() => {
          measureLabel()
          setFocused(!pointerFocus.current)
        }}
        onBlurCapture={() => {
          pointerFocus.current = false
          setFocused(false)
        }}
      >
        <Select
          ref={inputRef}
          aria-label="Oficina"
          placeholder="Oficina"
          data={options}
          value={selectedOfficeId ?? ALL_OFFICES}
          onChange={value => setSelectedOfficeId(value === ALL_OFFICES ? null : value)}
          onDropdownOpen={() => setDropdownOpened(true)}
          onDropdownClose={() => setDropdownOpened(false)}
          w={{ base: 138, sm: 200 }}
          size="sm"
        />
      </Box>
    </Tooltip>
  )
}
