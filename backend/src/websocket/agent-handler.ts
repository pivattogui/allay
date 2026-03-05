import { Elysia, t } from 'elysia';
import { nodeManager } from '../modules/agent/node-manager.js';
import { config } from '../config.js';
import type { WSClient } from '../types/ws.js';
import { broadcast } from './handler.js';

interface AgentConnection {
  nodeId: string;
  ws: WSClient;
}

const agentConnections = new Map<string, AgentConnection>();

export const setupAgentWebSocket = new Elysia()
  .ws('/ws/agent', {
    query: t.Object({
      nodeId: t.String(),
      token: t.Optional(t.String()),
    }),

    beforeHandle({ query, headers, set }) {
      const authHeader = (headers as Record<string, string>)?.authorization || '';
      const headerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      const token = headerToken || query.token;
      if (token !== config.agent.token) {
        set.status = 401;
        throw new Error('Unauthorized');
      }
    },

    open(ws) {
      const wsClient = ws as unknown as WSClient;
      const { nodeId } = ws.data.query;

      agentConnections.set(nodeId, { nodeId, ws: wsClient });
      console.info(`[AgentWS] Agent connected: ${nodeId}`);
    },

    message(_ws, data) {
      try {
        const message = typeof data === 'string' ? JSON.parse(data) : data as any;
        handleAgentMessage(message);
      } catch (err) {
        console.error('[AgentWS] Failed to parse message:', err);
      }
    },

    close(ws) {
      const wsClient = ws as unknown as WSClient;
      for (const [nodeId, conn] of agentConnections) {
        if (conn.ws.id === wsClient.id) {
          agentConnections.delete(nodeId);
          console.info(`[AgentWS] Agent disconnected: ${nodeId}`);
          break;
        }
      }
    },
  });

async function handleAgentMessage(message: any) {
  switch (message.type) {
    case 'heartbeat':
      await nodeManager.handleHeartbeat(message.nodeId, {
        servers: message.servers,
        resources: message.resources,
      });
      break;

    case 'log':
      broadcast(message.serverId, 'logs', {
        type: 'log',
        serverId: message.serverId,
        data: {
          timestamp: message.timestamp,
          level: message.level,
          message: message.message,
        },
      });
      break;

    case 'status':
      broadcast(message.serverId, 'status', {
        type: 'status',
        serverId: message.serverId,
        data: {
          state: message.state,
          pid: message.pid,
          uptime: message.uptime,
        },
      });
      break;

    case 'metrics':
      broadcast(message.serverId, 'metrics', {
        type: 'metrics',
        serverId: message.serverId,
        data: {
          cpuPercent: message.cpuPercent,
          ramUsedMb: message.ramUsedMb,
          ramMaxMb: message.ramMaxMb,
          playerCount: message.playerCount,
          playerMax: message.playerMax,
        },
      });
      break;
  }
}

export function getAgentConnection(nodeId: string): AgentConnection | undefined {
  return agentConnections.get(nodeId);
}
