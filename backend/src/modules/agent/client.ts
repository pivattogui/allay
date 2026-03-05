export interface AgentNode {
  id: string;
  host: string;
  port: number;
  token: string;
}

export class AgentClient {
  private node: AgentNode;
  private baseUrl: string;

  constructor(node: AgentNode) {
    this.node = node;
    this.baseUrl = `http://${node.host}:${node.port}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.node.token}`,
      'Content-Type': 'application/json',
    };

    const resp = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!resp.ok) {
      const error = await resp.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Agent request failed: ${(error as any).error || resp.statusText}`);
    }

    return resp.json() as Promise<T>;
  }

  async health() {
    return this.request<{ status: string }>('GET', '/health');
  }

  async getSystemResources() {
    return this.request<any>('GET', '/system/resources');
  }

  async getSystemInfo() {
    return this.request<any>('GET', '/system/info');
  }

  async provisionServer(data: {
    id: string;
    name: string;
    type: string;
    version: string;
    port: number;
    ramMin: number;
    ramMax: number;
    jvmArgs?: string[];
  }) {
    return this.request<{ status: string }>('POST', '/servers', data);
  }

  async deleteServer(serverId: string) {
    return this.request<{ status: string }>('DELETE', `/servers/${serverId}`);
  }

  async startServer(serverId: string) {
    return this.request<{ status: string; pid: number }>('POST', `/servers/${serverId}/start`);
  }

  async stopServer(serverId: string) {
    return this.request<{ status: string }>('POST', `/servers/${serverId}/stop`);
  }

  async killServer(serverId: string) {
    return this.request<{ status: string }>('POST', `/servers/${serverId}/kill`);
  }

  async restartServer(serverId: string) {
    return this.request<{ status: string }>('POST', `/servers/${serverId}/restart`);
  }

  async sendCommand(serverId: string, command: string) {
    return this.request<{ status?: string; response?: string }>('POST', `/servers/${serverId}/command`, { command });
  }

  async getServerStatus(serverId: string) {
    return this.request<{ id: string; state: string; pid?: number; startedAt?: string; port: number }>('GET', `/servers/${serverId}/status`);
  }

  async getServerLogs(serverId: string, lines = 100) {
    return this.request<{ lines: string[] }>('GET', `/servers/${serverId}/logs?lines=${lines}`);
  }

  async listFiles(serverId: string, subPath = '') {
    const query = subPath ? `?path=${encodeURIComponent(subPath)}` : '';
    return this.request<any[]>('GET', `/servers/${serverId}/files${query}`);
  }

  async readFile(serverId: string, filePath: string) {
    const url = `${this.baseUrl}/servers/${serverId}/files/${filePath}`;
    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${this.node.token}` },
    });
    if (!resp.ok) throw new Error('Failed to read file from agent');
    return resp;
  }

  async writeFile(serverId: string, filePath: string, content: string | Buffer) {
    const url = `${this.baseUrl}/servers/${serverId}/files/${filePath}`;
    const resp = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.node.token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: content,
    });
    if (!resp.ok) throw new Error('Failed to write file to agent');
    return resp.json();
  }

  async deleteFile(serverId: string, filePath: string) {
    return this.request<{ status: string }>('DELETE', `/servers/${serverId}/files/${filePath}`);
  }

  async createBackup(serverId: string) {
    return this.request<any>('POST', `/servers/${serverId}/backups`);
  }

  async listBackups(serverId: string) {
    return this.request<any[]>('GET', `/servers/${serverId}/backups`);
  }

  async restoreBackup(serverId: string, backupId: string) {
    return this.request<{ status: string }>('POST', `/servers/${serverId}/backups/${backupId}/restore`);
  }

  async deleteBackup(serverId: string, backupId: string) {
    return this.request<{ status: string }>('DELETE', `/servers/${serverId}/backups/${backupId}`);
  }

  async getJarVersions(type: string) {
    return this.request<any[]>('GET', `/jars/versions/${type}`);
  }

  async downloadJar(type: string, version: string) {
    return this.request<{ status: string }>('POST', '/jars/download', { type, version });
  }
}
