import { describe, expect, it } from 'vitest'
import { processManager } from './index.js'

describe('ProcessManager', () => {
  describe('getStatus', () => {
    it('returns stopped for unknown server', () => {
      const status = processManager.getStatus('nonexistent-id')
      expect(status).toEqual({ state: 'stopped' })
    })
  })

  describe('getLogs', () => {
    it('returns empty array for unknown server', () => {
      const logs = processManager.getLogs('nonexistent-id')
      expect(logs).toEqual([])
    })
  })

  describe('sendCommand', () => {
    it('returns false for unknown server', () => {
      const result = processManager.sendCommand('nonexistent-id', 'stop')
      expect(result).toBe(false)
    })
  })

  describe('getRunningServers', () => {
    it('returns empty array when no servers running', () => {
      const running = processManager.getRunningServers()
      expect(running).toEqual([])
    })
  })
})
