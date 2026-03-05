import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { nodes, servers } from '../../db/schema.js';
import { AgentClient } from './client.js';
import { config } from '../../config.js';

class NodeManager {
  private agentToken: string;
  private heartbeatCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.agentToken = config.agent.token;
  }

  async register(data: {
    name: string;
    host: string;
    port: number;
    resources: {
      cpuCores?: number;
      ramTotalMb?: number;
      diskTotalGb?: number;
    };
  }) {
    const existing = await db.select()
      .from(nodes)
      .where(eq(nodes.host, data.host))
      .limit(1);

    if (existing.length > 0) {
      const node = existing[0];
      await db.update(nodes).set({
        name: data.name,
        port: data.port,
        status: 'online',
        cpuCores: data.resources.cpuCores,
        ramTotalMb: data.resources.ramTotalMb,
        diskTotalGb: data.resources.diskTotalGb,
        lastHeartbeat: new Date(),
      }).where(eq(nodes.id, node.id));

      return { nodeId: node.id };
    }

    const [node] = await db.insert(nodes).values({
      name: data.name,
      host: data.host,
      port: data.port,
      status: 'online',
      cpuCores: data.resources.cpuCores,
      ramTotalMb: data.resources.ramTotalMb,
      diskTotalGb: data.resources.diskTotalGb,
      lastHeartbeat: new Date(),
    }).returning();

    return { nodeId: node.id };
  }

  async getClientForServer(serverId: string): Promise<AgentClient> {
    const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
    if (!server) throw new Error('Server not found');
    if (!server.nodeId) throw new Error('Server is not assigned to a node');

    return this.getClientForNode(server.nodeId);
  }

  async getClientForNode(nodeId: string): Promise<AgentClient> {
    const [node] = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1);
    if (!node) throw new Error('Node not found');

    return new AgentClient({
      id: node.id,
      host: node.host,
      port: node.port,
      token: this.agentToken,
    });
  }

  async getAllNodes() {
    return db.select().from(nodes);
  }

  async getNode(nodeId: string) {
    const [node] = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1);
    return node;
  }

  async deleteNode(nodeId: string) {
    const nodeServers = await db.select().from(servers).where(eq(servers.nodeId, nodeId));
    if (nodeServers.length > 0) {
      throw new Error('Cannot delete node with assigned servers');
    }
    await db.delete(nodes).where(eq(nodes.id, nodeId));
  }

  async handleHeartbeat(nodeId: string, data: {
    servers: Record<string, string>;
    resources: {
      cpuPercent: number;
      ramUsedMb: number;
      ramTotalMb: number;
      diskUsedGb: number;
      diskTotalGb: number;
    };
  }) {
    await db.update(nodes).set({
      status: 'online',
      lastHeartbeat: new Date(),
      ramTotalMb: data.resources.ramTotalMb,
      diskTotalGb: data.resources.diskTotalGb,
    }).where(eq(nodes.id, nodeId));

    // Reconcile server states from agent heartbeat
    if (data.servers && typeof data.servers === 'object') {
      const nodeServers = await db.select().from(servers).where(eq(servers.nodeId, nodeId));
      for (const server of nodeServers) {
        const agentState = data.servers[server.id];
        if (agentState) {
          // Log discrepancies for monitoring
          // The agent is the source of truth for running state
        } else {
          console.warn(`[NodeManager] Server ${server.id} assigned to node ${nodeId} but not reported in heartbeat`);
        }
      }
    }
  }

  startHeartbeatMonitor() {
    this.heartbeatCheckInterval = setInterval(async () => {
      const threshold = new Date(Date.now() - 90_000);
      const onlineNodes = await db.select().from(nodes).where(eq(nodes.status, 'online'));

      for (const node of onlineNodes) {
        if (!node.lastHeartbeat || node.lastHeartbeat < threshold) {
          await db.update(nodes).set({ status: 'offline' }).where(eq(nodes.id, node.id));
          console.warn(`[NodeManager] Node ${node.name} (${node.id}) marked offline`);
        }
      }
    }, 30_000);
  }

  stopHeartbeatMonitor() {
    if (this.heartbeatCheckInterval) {
      clearInterval(this.heartbeatCheckInterval);
    }
  }
}

export const nodeManager = new NodeManager();
