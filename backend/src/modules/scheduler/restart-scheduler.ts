import { EventEmitter } from 'node:events'
import { CronExpressionParser } from 'cron-parser'
import { and, isNotNull, ne } from 'drizzle-orm'
import cron, { type ScheduledTask } from 'node-cron'
import { db } from '../../db/index.js'
import { servers } from '../../db/schema.js'
import { createLogger } from '../../logger.js'

const log = createLogger('scheduler')

interface ScheduleInfo {
  task: ScheduledTask
  cronExpression: string
  serverId: string
}

class RestartSchedulerService extends EventEmitter {
  private schedules: Map<string, ScheduleInfo> = new Map()
  private initialized = false

  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    const rows = await db
      .select()
      .from(servers)
      .where(and(isNotNull(servers.restartSchedule), ne(servers.restartSchedule, '')))

    for (const server of rows) {
      if (server.restartSchedule) {
        this.setSchedule(server.id, server.restartSchedule)
      }
    }

    log.info({ count: rows.length }, 'Restart schedules initialized')
    this.initialized = true
  }

  setSchedule(serverId: string, cronExpression: string | null): void {
    const existing = this.schedules.get(serverId)
    if (existing) {
      existing.task.stop()
      this.schedules.delete(serverId)
    }

    if (cronExpression && cron.validate(cronExpression)) {
      const task = cron.schedule(cronExpression, () => {
        this.emit('server:restart-scheduled', serverId)
      })

      this.schedules.set(serverId, { task, cronExpression, serverId })
      log.debug({ serverId, cronExpression }, 'Restart schedule set')
    } else if (cronExpression) {
      log.warn({ serverId, cronExpression }, 'Invalid cron expression for restart schedule')
    }
  }

  getSchedule(serverId: string): string | null {
    const info = this.schedules.get(serverId)
    return info ? info.cronExpression : null
  }

  getNextRun(serverId: string): Date | null {
    const info = this.schedules.get(serverId)
    if (!info) return null

    try {
      const interval = CronExpressionParser.parse(info.cronExpression)
      return interval.next().toDate()
    } catch {
      return null
    }
  }

  hasSchedule(serverId: string): boolean {
    return this.schedules.has(serverId)
  }

  getAllSchedules(): Array<{ serverId: string; cronExpression: string }> {
    return Array.from(this.schedules.values()).map((info) => ({
      serverId: info.serverId,
      cronExpression: info.cronExpression,
    }))
  }

  validateCron(expression: string): boolean {
    return cron.validate(expression)
  }

  shutdown(): void {
    for (const [_serverId, info] of this.schedules) {
      info.task.stop()
    }
    this.schedules.clear()
    this.initialized = false
  }
}

export const restartScheduler = new RestartSchedulerService()
