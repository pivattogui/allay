import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { checkAuthStatus, checkAuthMe } from '../lib/api'

interface AuthState {
  isAuthenticated: boolean | null
  setupRequired: boolean | null
  token: string | null

  // Actions
  checkAuth: () => Promise<void>
  login: (token: string) => void
  logout: () => void
  setSetupRequired: (required: boolean) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      isAuthenticated: null,
      setupRequired: null,
      token: null,

      checkAuth: async () => {
        try {
          // Check if setup is required
          const statusData = await checkAuthStatus()
          set({ setupRequired: statusData.setupRequired })

          // Check if we have a valid token
          const currentToken = get().token || localStorage.getItem('token')
          if (!currentToken) {
            set({ isAuthenticated: false, token: null })
            return
          }

          // Verify token is still valid
          try {
            await checkAuthMe()
            set({ isAuthenticated: true, token: currentToken })
          } catch {
            // Token invalid
            localStorage.removeItem('token')
            set({ isAuthenticated: false, token: null })
          }
        } catch {
          set({ isAuthenticated: false })
        }
      },

      login: (token: string) => {
        localStorage.setItem('token', token)
        set({ isAuthenticated: true, token })
      },

      logout: () => {
        localStorage.removeItem('token')
        set({ isAuthenticated: false, token: null })
      },

      setSetupRequired: (required: boolean) => {
        set({ setupRequired: required })
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ token: state.token }),
    }
  )
)
