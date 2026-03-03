import cron, { ScheduledTask } from 'node-cron';
import { EventEmitter } from 'node:events';
import { isNotNull, and, ne } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { servers } from '../../db/schema.js';

interface ScheduleInfo {
  task: ScheduledTask;
  cronExpression: string;
  serverId: string;
}

class RestartSchedulerService extends EventEmitter {
  private schedules: Map<string, ScheduleInfo> = new Map();
  private initialized = false;

  constructor() {
    super();
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('[RestartScheduler] Already initialized');
      return;
    }

    const rows = await db
      .select()
      .from(servers)
      .where(and(isNotNull(servers.restartSchedule), ne(servers.restartSchedule, '')));

    for (const server of rows) {
      if (server.restartSchedule) {
        this.setSchedule(server.id, server.restartSchedule);
      }
    }

    this.initialized = true;
    console.log(`[RestartScheduler] Initialized with ${this.schedules.size} scheduled restarts`);
  }

  setSchedule(serverId: string, cronExpression: string | null): void {
    const existing = this.schedules.get(serverId);
    if (existing) {
      existing.task.stop();
      this.schedules.delete(serverId);
      console.log(`[RestartScheduler] Removed schedule for server ${serverId}`);
    }

    if (cronExpression && cron.validate(cronExpression)) {
      const task = cron.schedule(cronExpression, () => {
        console.log(`[RestartScheduler] Triggering restart for server ${serverId}`);
        this.emit('server:restart-scheduled', serverId);
      });

      this.schedules.set(serverId, { task, cronExpression, serverId });
      console.log(`[RestartScheduler] Set schedule for server ${serverId}: ${cronExpression}`);
    } else if (cronExpression) {
      console.warn(`[RestartScheduler] Invalid cron expression for server ${serverId}: ${cronExpression}`);
    }
  }

  getSchedule(serverId: string): string | null {
    const info = this.schedules.get(serverId);
    return info ? info.cronExpression : null;
  }

  getNextRun(serverId: string): Date | null {
    const info = this.schedules.get(serverId);
    if (!info) return null;

    try {
      const interval = cron.validate(info.cronExpression);
      if (interval) {
        return null;
      }
    } catch {
      return null;
    }

    return null;
  }

  hasSchedule(serverId: string): boolean {
    return this.schedules.has(serverId);
  }

  getAllSchedules(): Array<{ serverId: string; cronExpression: string }> {
    return Array.from(this.schedules.values()).map((info) => ({
      serverId: info.serverId,
      cronExpression: info.cronExpression,
    }));
  }

  validateCron(expression: string): boolean {
    return cron.validate(expression);
  }

  shutdown(): void {
    for (const [serverId, info] of this.schedules) {
      info.task.stop();
      console.log(`[RestartScheduler] Stopped schedule for server ${serverId}`);
    }
    this.schedules.clear();
    this.initialized = false;
    console.log('[RestartScheduler] Shutdown complete');
  }
}

export const restartScheduler = new RestartSchedulerService();
