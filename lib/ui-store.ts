import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type UiState = {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  // Organization portal's cross-cutting office filter (TopBar OfficeSelector).
  // Read by modules/assets/hooks/use-assets.ts as a queryKey/param input — Zustand
  // never gets written back to from a query result, only read from.
  selectedOfficeId: string | null;
  setSelectedOfficeId: (id: string | null) => void;
};

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      selectedOfficeId: null,
      setSelectedOfficeId: (id) => set({ selectedOfficeId: id }),
    }),
    { name: 'siam.ui-store' },
  ),
);
