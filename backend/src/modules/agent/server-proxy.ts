import { nodeManager } from './node-manager.js';
import type { ServerStatus } from '../../types/index.js';

export type ServerRow = {
  id: string;
  nodeId: string | null;
  directory: string;
  [key: string]: any;
};

function requireNode(server: ServerRow): void {
  if (!server.nodeId) {
    throw new Error(`Server ${server.id} is not assigned to a node`);
  }
}

export async function getStatus(server: ServerRow): Promise<ServerStatus> {
  if (!server.nodeId) {
    return { state: 'stopped' };
  }
  try {
    const client = await nodeManager.getClientForNode(server.nodeId);
    const agentStatus = await client.getServerStatus(server.id);
    return {
      state: agentStatus.state as ServerStatus['state'],
      pid: agentStatus.pid,
      uptime: agentStatus.startedAt
        ? Math.floor((Date.now() - new Date(agentStatus.startedAt).getTime()) / 1000)
        : undefined,
    };
  } catch (err) {
    console.error(`[ServerProxy] getStatus failed for ${server.id}:`, err);
    return { state: 'stopped' };
  }
}

export async function startServer(server: ServerRow): Promise<void> {
  requireNode(server);
  const client = await nodeManager.getClientForNode(server.nodeId!);
  await client.startServer(server.id);
}

export async function stopServer(server: ServerRow): Promise<void> {
  requireNode(server);
  const client = await nodeManager.getClientForNode(server.nodeId!);
  await client.stopServer(server.id);
}

export async function killServer(server: ServerRow): Promise<void> {
  requireNode(server);
  const client = await nodeManager.getClientForNode(server.nodeId!);
  await client.killServer(server.id);
}

export async function sendCommand(server: ServerRow, command: string): Promise<{ sent: boolean; response?: string }> {
  requireNode(server);
  const client = await nodeManager.getClientForNode(server.nodeId!);
  const result = await client.sendCommand(server.id, command);
  return { sent: true, response: result.response };
}

export async function getLogs(server: ServerRow, lines: number): Promise<string[]> {
  if (!server.nodeId) {
    return [];
  }
  try {
    const client = await nodeManager.getClientForNode(server.nodeId);
    const result = await client.getServerLogs(server.id, lines);
    return result.lines;
  } catch {
    return [];
  }
}

export async function deprovisionOnAgent(server: ServerRow): Promise<void> {
  requireNode(server);
  const client = await nodeManager.getClientForNode(server.nodeId!);
  await client.deleteServer(server.id);
}

export async function restartServer(server: ServerRow): Promise<void> {
  requireNode(server);
  const client = await nodeManager.getClientForNode(server.nodeId!);
  await client.restartServer(server.id);
}

// --- File operations ---

export async function listFiles(server: ServerRow, subPath: string): Promise<any[]> {
  requireNode(server);
  const client = await nodeManager.getClientForNode(server.nodeId!);
  return client.listFiles(server.id, subPath);
}

export async function readFile(server: ServerRow, filePath: string): Promise<Response> {
  requireNode(server);
  const client = await nodeManager.getClientForNode(server.nodeId!);
  return client.readFile(server.id, filePath);
}

export async function writeFile(server: ServerRow, filePath: string, content: string | Buffer): Promise<any> {
  requireNode(server);
  const client = await nodeManager.getClientForNode(server.nodeId!);
  return client.writeFile(server.id, filePath, content);
}

export async function deleteFile(server: ServerRow, filePath: string): Promise<any> {
  requireNode(server);
  const client = await nodeManager.getClientForNode(server.nodeId!);
  return client.deleteFile(server.id, filePath);
}

// --- Backup operations ---

export async function createBackup(server: ServerRow): Promise<any> {
  requireNode(server);
  const client = await nodeManager.getClientForNode(server.nodeId!);
  return client.createBackup(server.id);
}

export async function listBackups(server: ServerRow): Promise<any[]> {
  requireNode(server);
  const client = await nodeManager.getClientForNode(server.nodeId!);
  return client.listBackups(server.id);
}

export async function restoreBackup(server: ServerRow, backupId: string): Promise<any> {
  requireNode(server);
  const client = await nodeManager.getClientForNode(server.nodeId!);
  return client.restoreBackup(server.id, backupId);
}

export async function deleteBackup(server: ServerRow, backupId: string): Promise<any> {
  requireNode(server);
  const client = await nodeManager.getClientForNode(server.nodeId!);
  return client.deleteBackup(server.id, backupId);
}

// --- Properties operations ---

export async function readProperties(server: ServerRow): Promise<string> {
  requireNode(server);
  const client = await nodeManager.getClientForNode(server.nodeId!);
  const resp = await client.readFile(server.id, 'server.properties');
  return resp.text();
}

export async function writeProperties(server: ServerRow, content: string): Promise<void> {
  requireNode(server);
  const client = await nodeManager.getClientForNode(server.nodeId!);
  await client.writeFile(server.id, 'server.properties', content);
}

// --- Icon operations ---

export async function readIcon(server: ServerRow): Promise<Response> {
  requireNode(server);
  const client = await nodeManager.getClientForNode(server.nodeId!);
  return client.readFile(server.id, 'server-icon.png');
}

export async function writeIcon(server: ServerRow, content: Buffer): Promise<void> {
  requireNode(server);
  const client = await nodeManager.getClientForNode(server.nodeId!);
  await client.writeFile(server.id, 'server-icon.png', content);
}

export async function deleteIcon(server: ServerRow): Promise<void> {
  requireNode(server);
  const client = await nodeManager.getClientForNode(server.nodeId!);
  await client.deleteFile(server.id, 'server-icon.png');
}
