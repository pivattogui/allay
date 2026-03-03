import os from 'node:os';
import pidusage from 'pidusage';
import { eq } from 'drizzle-orm';
import { processManager } from '../process/index.js';
import { db } from '../../db/index.js';
import { servers } from '../../db/schema.js';
import type { ServerMetrics } from '../../types/index.js';
import type { WSClient } from '../../types/ws.js';
import { WS_OPEN } from '../../types/ws.js';

const CPU_COUNT = os.cpus().length;

interface MetricsState {
  pid: number;
  interval: NodeJS.Timeout;
  current: ServerMetrics | null;
  subscribers: Map<string, WSClient>;
  playerCount: number;
  playerMax: number;
  ramMaxMb: number;
}

class MetricsCollector {
  private servers: Map<string, MetricsState> = new Map();
  private pendingSubscribers: Map<string, Map<string, WSClient>> = new Map();
  private readonly collectInterval = 5000;

  constructor() {
    processManager.on('running', (serverId: string) => {
      const status = processManager.getStatus(serverId);
      if (status.pid) {
        this.start(serverId, status.pid);
      }
    });

    processManager.on('exit', (serverId: string) => {
      this.stop(serverId);
    });

    processManager.on('log', (serverId: string, line: string) => {
      this.parsePlayerEvent(serverId, line);
    });
  }

  async start(serverId: string, pid: number): Promise<void> {
    if (this.servers.has(serverId)) {
      this.stop(serverId);
    }

    const [row] = await db
      .select({ ramMaxMb: servers.ramMaxMb })
      .from(servers)
      .where(eq(servers.id, serverId))
      .limit(1);
    const ramMaxMb = row?.ramMaxMb || 2048;

    const pendingSubs = this.pendingSubscribers.get(serverId) || new Map();
    this.pendingSubscribers.delete(serverId);

    const state: MetricsState = {
      pid,
      interval: setInterval(() => this.collect(serverId), this.collectInterval),
      current: null,
      subscribers: pendingSubs,
      playerCount: 0,
      playerMax: 20,
      ramMaxMb,
    };

    this.servers.set(serverId, state);
    this.collect(serverId);
  }

  stop(serverId: string): void {
    const state = this.servers.get(serverId);
    if (state) {
      clearInterval(state.interval);
      this.servers.delete(serverId);
    }
  }

  subscribe(serverId: string, socket: WSClient): void {
    const state = this.servers.get(serverId);
    if (state) {
      state.subscribers.set(socket.id, socket);

      if (state.current) {
        socket.send(JSON.stringify({
          type: 'metrics',
          serverId,
          data: state.current,
        }));
      }
    } else {
      if (!this.pendingSubscribers.has(serverId)) {
        this.pendingSubscribers.set(serverId, new Map());
      }
      this.pendingSubscribers.get(serverId)!.set(socket.id, socket);
    }
  }

  unsubscribe(serverId: string, socketId: string): void {
    const state = this.servers.get(serverId);
    if (state) {
      state.subscribers.delete(socketId);
    }
    this.pendingSubscribers.get(serverId)?.delete(socketId);
  }

  getCurrent(serverId: string): ServerMetrics | null {
    return this.servers.get(serverId)?.current || null;
  }

  getPlayerCount(serverId: string): number {
    return this.servers.get(serverId)?.playerCount || 0;
  }

  private async collect(serverId: string): Promise<void> {
    const state = this.servers.get(serverId);
    if (!state) return;

    try {
      const stats = await pidusage(state.pid);

      const metrics: ServerMetrics = {
        timestamp: new Date().toISOString(),
        ramUsedMb: Math.round(stats.memory / 1024 / 1024),
        ramMaxMb: state.ramMaxMb,
        cpuPercent: Math.round((stats.cpu / CPU_COUNT) * 10) / 10,
        playerCount: state.playerCount,
        playerMax: state.playerMax,
      };

      state.current = metrics;
      this.broadcastMetrics(serverId, metrics);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
        this.stop(serverId);
      }
    }
  }

  private broadcastMetrics(serverId: string, metrics: ServerMetrics): void {
    const state = this.servers.get(serverId);
    if (!state) return;

    const message = JSON.stringify({ type: 'metrics', serverId, data: metrics });

    for (const [id, socket] of state.subscribers) {
      if (socket.readyState === WS_OPEN) {
        socket.send(message);
      } else {
        state.subscribers.delete(id);
      }
    }
  }

  private parsePlayerEvent(serverId: string, line: string): void {
    const state = this.servers.get(serverId);
    if (!state) return;

    if (line.includes('joined the game')) {
      state.playerCount++;
      this.emitPlayerUpdate(serverId, state);
    }

    if (line.includes('left the game')) {
      state.playerCount = Math.max(0, state.playerCount - 1);
      this.emitPlayerUpdate(serverId, state);
    }

    const maxPlayersMatch = line.match(/max-players[=:]?\s*(\d+)/i);
    if (maxPlayersMatch) {
      state.playerMax = parseInt(maxPlayersMatch[1], 10);
    }

    const playersOnlineMatch = line.match(/There are (\d+) of a max of (\d+) players online/);
    if (playersOnlineMatch) {
      state.playerCount = parseInt(playersOnlineMatch[1], 10);
      state.playerMax = parseInt(playersOnlineMatch[2], 10);
      this.emitPlayerUpdate(serverId, state);
    }
  }

  private emitPlayerUpdate(serverId: string, state: MetricsState): void {
    if (state.current) {
      state.current.playerCount = state.playerCount;
      state.current.playerMax = state.playerMax;
      this.broadcastMetrics(serverId, state.current);
    }
  }
}

export const metricsCollector = new MetricsCollector();
