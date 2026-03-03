export interface ServerStatus {
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';
  uptime?: number;
  players?: number;
  maxPlayers?: number;
}

export interface Server {
  id: string;
  name: string;
  type: string;
  version: string;
  port: number;
  ramMinMb: number;
  ramMaxMb: number;
  status: ServerStatus;
}

export interface ServerMetrics {
  cpu: number;
  memory: number;
  tps?: number;
  players?: number;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

export interface Backup {
  id: string;
  name: string;
  size: number;
  createdAt: string;
}
