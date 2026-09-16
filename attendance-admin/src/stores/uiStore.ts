/**
 * src/stores/uiStore.ts
 *
 * Chrome state: is the sidebar collapsed, is the mobile drawer open.
 *
 * TWO SEPARATE FLAGS, NOT ONE
 * ----------------------------
 * `collapsed` is a desktop preference — icons only, to give a wide table more
 * room. It is remembered between sessions because it is a deliberate choice.
 *
 * `mobileOpen` is a transient overlay on narrow screens. It must NOT be
 * remembered: nobody wants to land on a page with a menu already covering it.
 *
 * Collapsing these into one boolean would mean a phone user who opened the menu
 * once finds it open on every visit, and a desktop user who collapsed the bar
 * finds it expanded after every reload.
 */

import { create } from 'zustand';

const STORAGE_KEY = 'nexus.sidebar.collapsed';

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    // Private mode, or storage disabled. Not worth breaking the app over.
    return false;
  }
}

interface UiState {
  collapsed: boolean;
  mobileOpen: boolean;
  toggleCollapsed: () => void;
  setMobileOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  collapsed: readStored(),
  mobileOpen: false,

  toggleCollapsed: () =>
    set((state) => {
      const next = !state.collapsed;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* ignore */
      }
      return { collapsed: next };
    }),

  setMobileOpen: (open) => set({ mobileOpen: open }),
}));
