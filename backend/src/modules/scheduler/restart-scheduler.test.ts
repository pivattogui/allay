import { describe, expect, it, vi } from 'vitest'

vi.mock('../../db/index.js', () => ({
  db: {},
}))

const { restartScheduler } = await import('./restart-scheduler.js')

describe('RestartScheduler', () => {
  describe('validateCron', () => {
    it('accepts valid cron expression', () => {
      expect(restartScheduler.validateCron('0 6 * * *')).toBe(true)
    })

    it('accepts every-N-minutes expression', () => {
      expect(restartScheduler.validateCron('*/30 * * * *')).toBe(true)
    })

    it('rejects invalid cron expression', () => {
      expect(restartScheduler.validateCron('not-a-cron')).toBe(false)
    })

    it('rejects empty string', () => {
      expect(restartScheduler.validateCron('')).toBe(false)
    })
  })

  describe('getSchedule', () => {
    it('returns null for unknown server', () => {
      expect(restartScheduler.getSchedule('nonexistent')).toBeNull()
    })
  })

  describe('getNextRun', () => {
    it('returns null for unknown server', () => {
      expect(restartScheduler.getNextRun('nonexistent')).toBeNull()
    })
  })

  describe('hasSchedule', () => {
    it('returns false for unknown server', () => {
      expect(restartScheduler.hasSchedule('nonexistent')).toBe(false)
    })
  })
})
