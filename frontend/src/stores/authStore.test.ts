import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from './authStore'

describe('authStore', () => {
  beforeEach(() => {
    useAuthStore.setState({
      isAuthenticated: null,
      setupRequired: null,
      token: null,
    })
    localStorage.clear()
  })

  describe('login', () => {
    it('sets token and authenticates', () => {
      useAuthStore.getState().login('test-token')

      const state = useAuthStore.getState()
      expect(state.isAuthenticated).toBe(true)
      expect(state.token).toBe('test-token')
      expect(localStorage.getItem('token')).toBe('test-token')
    })
  })

  describe('logout', () => {
    it('clears token and deauthenticates', () => {
      useAuthStore.getState().login('test-token')
      useAuthStore.getState().logout()

      const state = useAuthStore.getState()
      expect(state.isAuthenticated).toBe(false)
      expect(state.token).toBeNull()
      expect(localStorage.getItem('token')).toBeNull()
    })
  })

  describe('setSetupRequired', () => {
    it('updates setupRequired', () => {
      useAuthStore.getState().setSetupRequired(true)
      expect(useAuthStore.getState().setupRequired).toBe(true)

      useAuthStore.getState().setSetupRequired(false)
      expect(useAuthStore.getState().setupRequired).toBe(false)
    })
  })
})
