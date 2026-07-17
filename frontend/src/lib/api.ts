import { useAuthStore } from '../stores'
import type { Backup, Server } from '../types/server'
import { backendUrl, backendFetch as fetch } from './backend'

export function getAuthHeaders(): HeadersInit {
  // Use store's token as single source of truth
  const token = useAuthStore.getState().token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// Auth
export async function checkAuthStatus(): Promise<{ setupRequired: boolean }> {
  const res = await fetch('/api/auth/status')
  if (!res.ok) throw new Error('Failed to check auth status')
  return res.json()
}

export async function checkAuthMe(): Promise<{ user: { id: string; username: string } }> {
  const res = await fetch('/api/auth/me', {
    headers: getAuthHeaders(),
  })
  if (!res.ok) throw new Error('Not authenticated')
  return res.json()
}

export async function login(username: string, password: string): Promise<{ token: string }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Login failed')
  }
  return res.json()
}

export async function setupAdmin(username: string, password: string): Promise<{ token: string }> {
  const res = await fetch('/api/auth/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Setup failed')
  }
  return res.json()
}

// Servers
export async function fetchServers(): Promise<Server[]> {
  const res = await fetch('/api/servers', {
    headers: getAuthHeaders(),
  })
  if (!res.ok) throw new Error('Failed to fetch servers')
  const data = await res.json()
  return data.servers
}

export async function fetchServer(id: string): Promise<Server> {
  const res = await fetch(`/api/servers/${id}`, {
    headers: getAuthHeaders(),
  })
  if (!res.ok) throw new Error('Failed to fetch server')
  const data = await res.json()
  return data.server
}

export async function startServer(id: string): Promise<void> {
  const res = await fetch(`/api/servers/${id}/start`, {
    method: 'POST',
    headers: getAuthHeaders(),
  })
  if (!res.ok) throw new Error('Failed to start server')
}

export async function stopServer(id: string): Promise<void> {
  const res = await fetch(`/api/servers/${id}/stop`, {
    method: 'POST',
    headers: getAuthHeaders(),
  })
  if (!res.ok) throw new Error('Failed to stop server')
}

export async function deleteServer(id: string): Promise<void> {
  const res = await fetch(`/api/servers/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })
  if (!res.ok) throw new Error('Failed to delete server')
}

export interface CreateServerData {
  name: string
  type: string
  version: string
  port: number
  ramMinMb: number
  ramMaxMb: number
}

export async function createServer(data: CreateServerData): Promise<Server> {
  const res = await fetch('/api/servers', {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.error || 'Failed to create server')
  }
  const result = await res.json()
  return result.server
}

export async function sendCommand(serverId: string, command: string): Promise<void> {
  const res = await fetch(`/api/servers/${serverId}/command`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ command }),
  })
  if (!res.ok) throw new Error('Failed to send command')
}

// Server Types & Versions
export interface ServerType {
  id: string
  name: string
  description: string
}

export async function fetchServerTypes(): Promise<ServerType[]> {
  const res = await fetch('/api/server-types', {
    headers: getAuthHeaders(),
  })
  if (!res.ok) throw new Error('Failed to fetch server types')
  const data = await res.json()
  return data.types
}

export async function fetchVersions(type: string): Promise<string[]> {
  const res = await fetch(`/api/server-types/${type}/versions`, {
    headers: getAuthHeaders(),
  })
  if (!res.ok) throw new Error('Failed to fetch versions')
  const data = await res.json()
  return data.versions
}

// System
export interface SystemInfo {
  portRange?: { min: number; max: number }
}

export async function fetchSystemInfo(): Promise<SystemInfo> {
  const res = await fetch('/api/system/info', {
    headers: getAuthHeaders(),
  })
  if (!res.ok) throw new Error('Failed to fetch system info')
  return res.json()
}

export async function fetchSystemServerTypes(): Promise<ServerType[]> {
  const res = await fetch('/api/system/server-types', {
    headers: getAuthHeaders(),
  })
  if (!res.ok) throw new Error('Failed to fetch server types')
  const data = await res.json()
  return data.types
}

export async function fetchSystemVersions(type: string): Promise<string[]> {
  const res = await fetch(`/api/system/versions/${type}`, {
    headers: getAuthHeaders(),
  })
  if (!res.ok) throw new Error('Failed to fetch versions')
  const data = await res.json()
  return data.versions
}

// Backups
export interface BackupConfig {
  enabled: boolean
  intervalMinutes: number
  maxBackups: number
  includeLogs: boolean
  storagePath?: string
}

export interface BackupsResponse {
  backups: Backup[]
  config: BackupConfig
}

export async function fetchBackups(serverId: string): Promise<BackupsResponse> {
  const res = await fetch(`/api/backups/${serverId}`, {
    headers: getAuthHeaders(),
  })
  if (!res.ok) throw new Error('Failed to fetch backups')
  return res.json()
}

export async function createBackup(serverId: string, name: string): Promise<Backup> {
  const res = await fetch(`/api/backups/${serverId}`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error('Failed to create backup')
  const data = await res.json()
  return data.backup
}

export async function restoreBackup(serverId: string, backupId: string): Promise<void> {
  const res = await fetch(`/api/backups/${serverId}/${backupId}/restore`, {
    method: 'POST',
    headers: getAuthHeaders(),
  })
  if (!res.ok) throw new Error('Failed to restore backup')
}

export async function deleteBackup(serverId: string, backupId: string): Promise<void> {
  const res = await fetch(`/api/backups/${serverId}/${backupId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })
  if (!res.ok) throw new Error('Failed to delete backup')
}

export async function updateBackupConfig(serverId: string, config: Partial<BackupConfig>): Promise<BackupConfig> {
  const res = await fetch(`/api/backups/${serverId}/config`, {
    method: 'PATCH',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to update backup config')
  }
  const data = await res.json()
  return data.config
}

// Import types
export interface ImportAnalysis {
  importId: string
  detectedType: 'world-only' | 'full-backup' | 'mixed'
  categories: {
    world: string[]
    configs: string[]
    plugins: string[]
    jars: string[]
    logs: string[]
    other: string[]
  }
  suggestedPreset: 'world-only' | 'world-configs' | 'all-except-jars' | null
  totalSize: number
}

export interface ImportSelection {
  preset: 'world-only' | 'world-configs' | 'all-except-jars' | null
  include: string[]
  exclude: string[]
}

export interface ImportResult {
  message: string
  backupId: string
  importedPaths: number
}

export function analyzeImport(
  serverId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ImportAnalysis> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText))
      } else {
        try {
          const error = JSON.parse(xhr.responseText)
          reject(new Error(error.error || 'Analysis failed'))
        } catch {
          reject(new Error('Analysis failed'))
        }
      }
    })

    xhr.addEventListener('error', () => reject(new Error('Upload failed')))
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')))

    xhr.open('POST', backendUrl(`/api/backups/${serverId}/import/analyze`))
    const token = useAuthStore.getState().token
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.setRequestHeader('x-filename', encodeURIComponent(file.name))
    xhr.send(file)
  })
}

export async function executeImport(
  serverId: string,
  importId: string,
  selection: ImportSelection,
): Promise<ImportResult> {
  const res = await fetch(`/api/backups/${serverId}/import/${importId}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ selection }),
  })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Import failed')
  }
  return res.json()
}

// Properties
export async function fetchProperties(serverId: string): Promise<Record<string, string>> {
  const res = await fetch(`/api/servers/${serverId}/properties`, {
    headers: getAuthHeaders(),
  })
  if (!res.ok) throw new Error('Failed to fetch properties')
  const data = await res.json()
  return data.properties
}

export async function updateProperties(serverId: string, properties: Record<string, string>): Promise<void> {
  const res = await fetch(`/api/servers/${serverId}/properties`, {
    method: 'PUT',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties }),
  })
  if (!res.ok) throw new Error('Failed to update properties')
}

// API wrapper with axios-like interface for new hooks
export const api = {
  async get<T = unknown>(url: string): Promise<{ data: T }> {
    const res = await fetch(`/api${url}`, {
      headers: getAuthHeaders(),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `GET ${url} failed`)
    }
    const data = await res.json()
    return { data }
  },

  async post<T = unknown>(
    url: string,
    body?: unknown,
    options?: { headers?: Record<string, string> },
  ): Promise<{ data: T }> {
    const isFormData = body instanceof FormData
    const res = await fetch(`/api${url}`, {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...options?.headers,
      },
      body: isFormData ? body : body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `POST ${url} failed`)
    }
    const data = await res.json()
    return { data }
  },

  async patch<T = unknown>(url: string, body?: unknown): Promise<{ data: T }> {
    const res = await fetch(`/api${url}`, {
      method: 'PATCH',
      headers: {
        ...getAuthHeaders(),
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `PATCH ${url} failed`)
    }
    const data = await res.json()
    return { data }
  },

  async delete<T = unknown>(url: string): Promise<{ data: T }> {
    const res = await fetch(`/api${url}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `DELETE ${url} failed`)
    }
    const data = await res.json().catch(() => ({}))
    return { data }
  },
}
