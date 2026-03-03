import { spawn, execSync, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import type { Server, ServerState, ServerStatus } from '../../types/index.js';

interface ProcessInfo {
  process: ChildProcess;
  state: ServerState;
  startTime: number;
  logs: string[];
  lastError?: string;
}

class ProcessManager extends EventEmitter {
  private processes: Map<string, ProcessInfo> = new Map();
  private readonly maxLogLines = 1000;

  constructor() {
    super();
    this.on('error', (serverId: string, err: Error) => {
      console.error(`[ProcessManager] Server ${serverId} error:`, err.message);
    });
  }

  async start(server: Server): Promise<void> {
    if (this.processes.has(server.id)) {
      const info = this.processes.get(server.id)!;
      if (info.state === 'running' || info.state === 'starting') {
        throw new Error('Server is already running');
      }
    }

    // Clean up stale session.lock files
    this.cleanupStaleLocks(server.directory);

    // Build JVM arguments
    const javaArgs = [
      `-Xms${server.ramMinMb}M`,
      `-Xmx${server.ramMaxMb}M`,
    ];

    // Add custom JVM args if provided
    if (server.jvmArgs) {
      const customArgs = server.jvmArgs.split(/\s+/).filter(arg => arg.trim());
      javaArgs.push(...customArgs);
    }

    javaArgs.push('-jar', 'server.jar', 'nogui');

    // Resolve Java binary path (asdf shims may not work with async spawn in Bun)
    let javaCommand = server.javaPath || 'java';
    if (javaCommand === 'java') {
      try {
        const asdfPath = execSync('asdf where java 2>/dev/null', { encoding: 'utf-8' }).trim();
        const bin = path.join(asdfPath, 'bin', 'java');
        if (asdfPath && fs.existsSync(bin)) {
          javaCommand = bin;
        }
      } catch {
        // fallback to 'java'
      }
    }

    const proc = spawn(javaCommand, javaArgs, {
      cwd: server.directory,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!proc.pid) {
      throw new Error('Failed to start server process');
    }

    const info: ProcessInfo = {
      process: proc,
      state: 'starting',
      startTime: Date.now(),
      logs: [],
    };

    this.processes.set(server.id, info);

    // Handle stdout
    proc.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        this.addLog(server.id, line);

        // Detect when server is ready
        if (line.includes('Done') && line.includes('For help, type')) {
          info.state = 'running';
          this.emit('running', server.id);
        }
      }
    });

    // Handle stderr
    proc.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        this.addLog(server.id, `[ERROR] ${line}`);
      }
    });

    // Handle process exit
    proc.on('exit', (code, signal) => {
      const wasRunning = info.state === 'running';

      if (code === 0 || info.state === 'stopping') {
        info.state = 'stopped';
      } else {
        info.state = 'crashed';
        info.lastError = `Process exited with code ${code}, signal ${signal}`;
      }

      this.emit('exit', server.id, code, signal, wasRunning);
    });

    proc.on('error', (err) => {
      info.state = 'crashed';
      info.lastError = err.message;
      this.emit('error', server.id, err);
    });

    // Wait for process to start
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (info.state === 'starting') {
          resolve();
        }
      }, 5000);

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      proc.on('spawn', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  async stop(serverId: string, graceful = true): Promise<void> {
    const info = this.processes.get(serverId);
    if (!info || info.state === 'stopped') {
      return;
    }

    info.state = 'stopping';

    if (graceful && info.process.stdin) {
      info.process.stdin.write('stop\n');

      await Promise.race([
        new Promise<void>((resolve) => {
          info.process.on('exit', () => resolve());
        }),
        new Promise<void>((resolve) => {
          setTimeout(() => {
            if (info.state !== 'stopped') {
              info.process.kill('SIGTERM');
            }
            resolve();
          }, config.minecraft.shutdownTimeout);
        }),
      ]);
    } else {
      info.process.kill('SIGTERM');
    }

    await new Promise<void>((resolve) => {
      if (info.state === 'stopped') {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        info.process.kill('SIGKILL');
        info.state = 'stopped';
        resolve();
      }, 5000);

      info.process.on('exit', () => {
        clearTimeout(timeout);
        info.state = 'stopped';
        resolve();
      });
    });
  }

  async stopAll(): Promise<void> {
    const promises = Array.from(this.processes.keys()).map((id) => this.stop(id));
    await Promise.all(promises);
  }

  kill(serverId: string): void {
    const info = this.processes.get(serverId);
    if (!info) return;

    info.process.kill('SIGKILL');
    info.state = 'stopped';
  }

  getStatus(serverId: string): ServerStatus {
    const info = this.processes.get(serverId);

    if (!info) {
      return { state: 'stopped' };
    }

    return {
      state: info.state,
      pid: info.process.pid,
      uptime: info.state === 'running' ? Math.floor((Date.now() - info.startTime) / 1000) : undefined,
      lastError: info.lastError,
    };
  }

  getLogs(serverId: string, lines: number = 100): string[] {
    const info = this.processes.get(serverId);
    if (!info) return [];

    return info.logs.slice(-lines);
  }

  sendCommand(serverId: string, command: string): boolean {
    const info = this.processes.get(serverId);
    if (!info || info.state !== 'running' || !info.process.stdin) {
      return false;
    }

    info.process.stdin.write(`${command}\n`);
    return true;
  }

  private addLog(serverId: string, line: string): void {
    const info = this.processes.get(serverId);
    if (!info) return;

    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${line}`;

    info.logs.push(logLine);

    if (info.logs.length > this.maxLogLines) {
      info.logs = info.logs.slice(-this.maxLogLines);
    }

    this.emit('log', serverId, logLine);
  }

  getRunningServers(): string[] {
    return Array.from(this.processes.entries())
      .filter(([, info]) => info.state === 'running')
      .map(([id]) => id);
  }

  private cleanupStaleLocks(serverDir: string): void {
    const worldDirs = ['world', 'world_nether', 'world_the_end'];

    for (const worldDir of worldDirs) {
      const lockPath = path.join(serverDir, worldDir, 'session.lock');
      try {
        if (fs.existsSync(lockPath)) {
          fs.unlinkSync(lockPath);
          console.log(`[ProcessManager] Cleaned up stale lock: ${lockPath}`);
        }
      } catch (err) {
        console.warn(`[ProcessManager] Could not clean lock ${lockPath}:`, err);
      }
    }
  }
}

export const processManager = new ProcessManager();
