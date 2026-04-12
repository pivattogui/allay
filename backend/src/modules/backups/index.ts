import fs from 'node:fs';
import path from 'node:path';
import * as cron from 'node-cron';
import { eq, desc } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { servers, backupConfigs, backups, events } from '../../db/schema.js';
import { config } from '../../config.js';
import { processManager } from '../process/index.js';
import { metricsCollector } from '../metrics/index.js';

export interface BackupConfig {
  id: string;
  serverId: string;
  enabled: boolean;
  intervalMinutes: number;
  maxBackups: number;
  includeLogs: boolean;
}

export interface BackupRecord {
  id: string;
  serverId: string;
  filename: string;
  sizeBytes: number;
  type: 'manual' | 'scheduled';
  status: 'pending' | 'completed' | 'failed';
  createdAt: string;
}

class BackupManager {
  private scheduledJobs: Map<string, cron.ScheduledTask> = new Map();

  constructor() {
    if (!fs.existsSync(config.paths.backups)) {
      fs.mkdirSync(config.paths.backups, { recursive: true });
    }
  }

  async initializeSchedules(): Promise<void> {
    const configs = await db
      .select({
        serverId: backupConfigs.serverId,
        intervalMinutes: backupConfigs.intervalMinutes,
      })
      .from(backupConfigs)
      .innerJoin(servers, eq(servers.id, backupConfigs.serverId))
      .where(eq(backupConfigs.enabled, true));

    for (const cfg of configs) {
      this.scheduleBackup(cfg.serverId, cfg.intervalMinutes);
    }

    console.log(`[BackupManager] Initialized ${configs.length} backup schedules`);
  }

  scheduleBackup(serverId: string, intervalMinutes: number): void {
    this.cancelSchedule(serverId);

    if (intervalMinutes <= 0) return;

    let cronExpr: string;
    if (intervalMinutes < 60) {
      cronExpr = `*/${intervalMinutes} * * * *`;
    } else {
      const hours = Math.floor(intervalMinutes / 60);
      cronExpr = `0 */${hours} * * *`;
    }

    const task = cron.schedule(cronExpr, async () => {
      try {
        const playerCount = metricsCollector.getPlayerCount(serverId);
        if (playerCount === 0) {
          console.log(`[BackupManager] Skipping scheduled backup for ${serverId} - no players online`);
          return;
        }
        await this.createBackup(serverId, 'scheduled');
      } catch (err) {
        console.error(`[BackupManager] Scheduled backup failed for ${serverId}:`, err);
      }
    });

    this.scheduledJobs.set(serverId, task);
    console.log(`[BackupManager] Scheduled backup for ${serverId} every ${intervalMinutes} minutes`);
  }

  cancelSchedule(serverId: string): void {
    const existingJob = this.scheduledJobs.get(serverId);
    if (existingJob) {
      existingJob.stop();
      this.scheduledJobs.delete(serverId);
    }
  }

  async createBackup(serverId: string, type: 'manual' | 'scheduled' = 'manual'): Promise<BackupRecord> {
    const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
    if (!server) {
      throw new Error('Server not found');
    }

    const serverDir = server.directory;
    const status = processManager.getStatus(serverId);
    const isRunning = status.state === 'running';

    if (isRunning) {
      processManager.sendCommand(serverId, 'save-off');
      processManager.sendCommand(serverId, 'save-all');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${serverId}_${timestamp}.tar.gz`;
    const backupPath = path.join(config.paths.backups, filename);

    // Insert pending record before compression starts
    const [result] = await db.insert(backups).values({
      serverId,
      filename,
      sizeBytes: 0,
      type,
      status: 'pending',
    }).returning({ id: backups.id });

    const backupId = result.id;

    try {
      const [backupConfig] = await db.select().from(backupConfigs).where(eq(backupConfigs.serverId, serverId)).limit(1);
      const includeLogs = backupConfig?.includeLogs ?? false;

      const excludePatterns = ['--exclude=*.jar'];
      if (!includeLogs) {
        excludePatterns.push('--exclude=logs');
      }

      const tarArgs = [
        ...excludePatterns,
        '-czf', backupPath,
        '-C', path.dirname(serverDir),
        path.basename(serverDir),
      ];
      const tarProc = Bun.spawn(['tar', ...tarArgs], {
        stdout: 'ignore',
        stderr: 'pipe',
      });
      const tarExitCode = await tarProc.exited;
      if (tarExitCode > 1) {
        const stderr = await new Response(tarProc.stderr).text();
        throw new Error(`tar failed (exit ${tarExitCode}): ${stderr.slice(0, 200)}`);
      }

      const stats = fs.statSync(backupPath);

      await db.update(backups)
        .set({ sizeBytes: stats.size, status: 'completed' })
        .where(eq(backups.id, backupId));

      await db.insert(events).values({
        serverId,
        type: 'backup',
        message: `${type === 'manual' ? 'Manual' : 'Scheduled'} backup created: ${filename}`,
      });

      await this.applyRetentionPolicy(serverId);

      return {
        id: backupId,
        serverId,
        filename,
        sizeBytes: stats.size,
        type,
        status: 'completed' as const,
        createdAt: new Date().toISOString(),
      };
    } catch (err) {
      await db.update(backups)
        .set({ status: 'failed' })
        .where(eq(backups.id, backupId));
      throw err;
    } finally {
      if (isRunning) {
        processManager.sendCommand(serverId, 'save-on');
      }
    }
  }

  async listBackups(serverId: string): Promise<BackupRecord[]> {
    const rows = await db
      .select()
      .from(backups)
      .where(eq(backups.serverId, serverId))
      .orderBy(desc(backups.createdAt));

    return rows.map(row => ({
      id: row.id,
      serverId: row.serverId,
      filename: row.filename,
      sizeBytes: row.sizeBytes,
      type: row.type,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async restoreBackup(backupId: string): Promise<void> {
    const [backup] = await db.select().from(backups).where(eq(backups.id, backupId)).limit(1);
    if (!backup) {
      throw new Error('Backup not found');
    }

    const [server] = await db.select().from(servers).where(eq(servers.id, backup.serverId)).limit(1);
    if (!server) {
      throw new Error('Server not found');
    }

    const status = processManager.getStatus(backup.serverId);
    if (status.state === 'running' || status.state === 'starting') {
      throw new Error('Cannot restore while server is running. Stop the server first.');
    }

    const backupPath = path.join(config.paths.backups, backup.filename);
    if (!fs.existsSync(backupPath)) {
      throw new Error('Backup file not found');
    }

    const serverDir = server.directory;
    const parentDir = path.dirname(serverDir);
    const serverDirName = path.basename(serverDir);

    const preRestoreBackup = `${serverDirName}_pre_restore_${Date.now()}`;
    if (fs.existsSync(serverDir)) {
      fs.renameSync(serverDir, path.join(parentDir, preRestoreBackup));
    }

    try {
      const restoreProc = Bun.spawn(['tar', '-xzf', backupPath, '-C', parentDir], {
        stdout: 'ignore',
        stderr: 'pipe',
      });
      const restoreExitCode = await restoreProc.exited;
      if (restoreExitCode !== 0) {
        const stderr = await new Response(restoreProc.stderr).text();
        throw new Error(`tar extract failed (exit ${restoreExitCode}): ${stderr.slice(0, 200)}`);
      }

      const jarPath = path.join(parentDir, preRestoreBackup, 'server.jar');
      if (fs.existsSync(jarPath)) {
        fs.copyFileSync(jarPath, path.join(serverDir, 'server.jar'));
      }

      fs.rmSync(path.join(parentDir, preRestoreBackup), { recursive: true, force: true });

      await db.insert(events).values({
        serverId: backup.serverId,
        type: 'restore',
        message: `Restored from backup: ${backup.filename}`,
      });
    } catch (err) {
      if (fs.existsSync(path.join(parentDir, preRestoreBackup))) {
        if (fs.existsSync(serverDir)) {
          fs.rmSync(serverDir, { recursive: true, force: true });
        }
        fs.renameSync(path.join(parentDir, preRestoreBackup), serverDir);
      }
      throw err;
    }
  }

  async deleteBackup(backupId: string): Promise<void> {
    const [backup] = await db.select().from(backups).where(eq(backups.id, backupId)).limit(1);
    if (!backup) {
      throw new Error('Backup not found');
    }

    const backupPath = path.join(config.paths.backups, backup.filename);
    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }

    await db.delete(backups).where(eq(backups.id, backupId));
  }

  private async applyRetentionPolicy(serverId: string): Promise<void> {
    const [backupConfig] = await db.select().from(backupConfigs).where(eq(backupConfigs.serverId, serverId)).limit(1);
    if (!backupConfig) return;

    const maxBackupsCount = backupConfig.maxBackups || 10;

    const allBackups = await db
      .select({ id: backups.id, filename: backups.filename })
      .from(backups)
      .where(eq(backups.serverId, serverId))
      .orderBy(desc(backups.createdAt));

    if (allBackups.length > maxBackupsCount) {
      const toDelete = allBackups.slice(maxBackupsCount);
      for (const backup of toDelete) {
        try {
          const backupPath = path.join(config.paths.backups, backup.filename);
          if (fs.existsSync(backupPath)) {
            fs.unlinkSync(backupPath);
          }
          await db.delete(backups).where(eq(backups.id, backup.id));
          console.log(`[BackupManager] Deleted old backup: ${backup.filename}`);
        } catch (err) {
          console.error(`[BackupManager] Failed to delete backup ${backup.filename}:`, err);
        }
      }
    }
  }

  async getConfig(serverId: string): Promise<BackupConfig | null> {
    const [row] = await db.select().from(backupConfigs).where(eq(backupConfigs.serverId, serverId)).limit(1);
    if (!row) return null;

    return {
      id: row.id,
      serverId: row.serverId,
      enabled: row.enabled,
      intervalMinutes: row.intervalMinutes,
      maxBackups: row.maxBackups,
      includeLogs: row.includeLogs,
    };
  }

  async updateConfig(serverId: string, cfg: Partial<BackupConfig>): Promise<void> {
    const updateData: Partial<typeof backupConfigs.$inferInsert> = {};

    if (cfg.enabled !== undefined) updateData.enabled = cfg.enabled;
    if (cfg.intervalMinutes !== undefined) updateData.intervalMinutes = cfg.intervalMinutes;
    if (cfg.maxBackups !== undefined) updateData.maxBackups = cfg.maxBackups;
    if (cfg.includeLogs !== undefined) updateData.includeLogs = cfg.includeLogs;

    if (Object.keys(updateData).length > 0) {
      await db.update(backupConfigs).set(updateData).where(eq(backupConfigs.serverId, serverId));

      const newConfig = await this.getConfig(serverId);
      if (newConfig) {
        if (newConfig.enabled) {
          this.scheduleBackup(serverId, newConfig.intervalMinutes);
        } else {
          this.cancelSchedule(serverId);
        }
      }
    }
  }

  stopAll(): void {
    for (const [serverId, job] of this.scheduledJobs) {
      job.stop();
      console.log(`[BackupManager] Stopped backup schedule for ${serverId}`);
    }
    this.scheduledJobs.clear();
  }
}

export const backupManager = new BackupManager();
