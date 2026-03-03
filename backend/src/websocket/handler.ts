import { Elysia } from 'elysia';
import { processManager } from '../modules/process/index.js';
import { metricsCollector } from '../modules/metrics/index.js';
import type { WSClient } from '../types/ws.js';
import { WS_OPEN } from '../types/ws.js';

interface Subscription {
  serverId: string;
  channels: Set<'logs' | 'metrics' | 'status'>;
  ws: WSClient;
}

interface WSMessage {
  type: 'subscribe' | 'unsubscribe';
  serverId: string;
  channels: ('logs' | 'metrics' | 'status')[];
}

// Keyed by ws.id because Elysia creates a new wrapper object per handler call
// (open/message/close receive different JS objects for the same connection)
const clients = new Map<string, Subscription>();

export const setupWebSocket = new Elysia()
  .ws('/ws', {
    open(ws) {
      const wsClient = ws as unknown as WSClient;
      const subscription: Subscription = {
        serverId: '',
        channels: new Set(),
        ws: wsClient,
      };
      clients.set(wsClient.id, subscription);
    },

    message(ws, data) {
      try {
        const message: WSMessage = typeof data === 'string' ? JSON.parse(data) : data as WSMessage;
        const wsClient = ws as unknown as WSClient;
        const subscription = clients.get(wsClient.id);
        if (!subscription) return;
        subscription.ws = wsClient;
        handleMessage(wsClient, subscription, message);
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    },

    close(ws) {
      const wsClient = ws as unknown as WSClient;
      const subscription = clients.get(wsClient.id);

      if (subscription?.serverId && subscription.channels.has('metrics')) {
        metricsCollector.unsubscribe(subscription.serverId, wsClient.id);
      }
      clients.delete(wsClient.id);
    },
  });

setupProcessManagerListeners();

function handleMessage(socket: WSClient, subscription: Subscription, message: WSMessage) {
  const { type, serverId, channels } = message;

  if (type === 'subscribe') {
    if (subscription.serverId && subscription.serverId !== serverId) {
      if (subscription.channels.has('metrics')) {
        metricsCollector.unsubscribe(subscription.serverId, socket.id);
      }
    }

    subscription.serverId = serverId;

    for (const channel of channels) {
      subscription.channels.add(channel);

      if (channel === 'metrics') {
        metricsCollector.subscribe(serverId, socket);
      }
    }

    if (channels.includes('status')) {
      const status = processManager.getStatus(serverId);
      socket.send(JSON.stringify({
        type: 'status',
        serverId,
        data: status,
      }));
    }

    if (channels.includes('logs')) {
      const logs = processManager.getLogs(serverId, 50);
      for (const log of logs) {
        socket.send(JSON.stringify({
          type: 'log',
          serverId,
          data: parseLogLine(log),
        }));
      }
    }

    socket.send(JSON.stringify({ type: 'subscribed', serverId, channels }));
  } else if (type === 'unsubscribe') {
    for (const channel of channels) {
      subscription.channels.delete(channel);

      if (channel === 'metrics') {
        metricsCollector.unsubscribe(serverId, socket.id);
      }
    }

    socket.send(JSON.stringify({ type: 'unsubscribed', serverId, channels }));
  }
}

function setupProcessManagerListeners() {
  processManager.on('log', (serverId: string, line: string) => {
    broadcast(serverId, 'logs', {
      type: 'log',
      serverId,
      data: parseLogLine(line),
    });
  });

  processManager.on('running', (serverId: string) => {
    broadcast(serverId, 'status', {
      type: 'status',
      serverId,
      data: processManager.getStatus(serverId),
    });
  });

  processManager.on('exit', (serverId: string) => {
    broadcast(serverId, 'status', {
      type: 'status',
      serverId,
      data: processManager.getStatus(serverId),
    });
  });

  processManager.on('error', (serverId: string) => {
    broadcast(serverId, 'status', {
      type: 'status',
      serverId,
      data: processManager.getStatus(serverId),
    });
  });
}

function broadcast(serverId: string, channel: 'logs' | 'metrics' | 'status', message: object) {
  const messageStr = JSON.stringify(message);

  for (const [, subscription] of clients) {
    if (subscription.serverId === serverId && subscription.channels.has(channel)) {
      if (subscription.ws.readyState === WS_OPEN) {
        subscription.ws.send(messageStr);
      }
    }
  }
}

function parseLogLine(line: string): { timestamp: string; level: string; message: string } {
  const timestampMatch = line.match(/^\[([^\]]+)\]/);
  const levelMatch = line.match(/\[(INFO|WARN|ERROR)\]:/i);

  return {
    timestamp: timestampMatch?.[1] || new Date().toISOString(),
    level: (levelMatch?.[1] || 'info').toLowerCase(),
    message: line.replace(/^\[[^\]]+\]\s*/, '').replace(/\[\d{2}:\d{2}:\d{2}\s+\w+\]:\s*/, ''),
  };
}

export { broadcast };
