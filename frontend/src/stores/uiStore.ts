import { create } from 'zustand'

type PendingAction = 'start' | 'stop' | 'delete'

interface UIState {
  pendingActions: Record<string, PendingAction>
  sidebarCollapsed: boolean

  // Actions
  setPendingAction: (serverId: string, action: PendingAction | null) => void
  clearPendingAction: (serverId: string) => void
  toggleSidebar: () => void
}

export const useUIStore = create<UIState>()((set) => ({
  pendingActions: {},
  sidebarCollapsed: false,

  setPendingAction: (serverId: string, action: PendingAction | null) => {
    set((state) => {
      if (action === null) {
        const { [serverId]: _, ...rest } = state.pendingActions
        return { pendingActions: rest }
      }
      return {
        pendingActions: { ...state.pendingActions, [serverId]: action },
      }
    })
  },

  clearPendingAction: (serverId: string) => {
    set((state) => {
      const { [serverId]: _, ...rest } = state.pendingActions
      return { pendingActions: rest }
    })
  },

  toggleSidebar: () => {
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }))
  },
}))
