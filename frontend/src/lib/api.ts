import type { Server, Backup, Node } from '../types/server'
export type { Node }
import { useAuthStore } from '../stores'

function getAuthHeaders(): HeadersInit {
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
  nodeId?: string
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

// Import Backup
export interface BackupMetadata {
  format: 'allay' | 'generic' | 'world-only'
  serverType: 'vanilla' | 'paper' | 'unsupported'
  minecraftVersion: string | null
  hasJars: boolean
  jarFiles: string[]
  serverName: string | null
  port: number | null
  estimatedSize: number
  worldName: string | null
  hasDimensions: boolean
  dimensions: string[]
  rootPath: string
}

export interface DiffItem {
  id: string
  path: string
  category: 'config' | 'world' | 'plugins' | 'other'
  type: 'file' | 'directory'
  status: 'only-backup' | 'only-server' | 'modified'
  backupSize?: number
  serverSize?: number
  isText: boolean
  backupPreview?: string
  serverPreview?: string
  isJar: boolean
}

export interface DiffResult {
  items: DiffItem[]
  summary: {
    totalDiffs: number
    byCategory: Record<string, number>
    byStatus: Record<string, number>
  }
}

export interface DiffSelection {
  id: string
  action: 'keep' | 'use-backup'
}

export interface UploadResponse {
  tempFileId: string
  metadata: BackupMetadata
}

export interface ApplyResult {
  success: boolean
  applied: number
  error?: string
  errorCode?: string
}


// ============================================
// BACKUP IMPORT API (Server Files Context)
// ============================================

// Upload backup for import (uses XHR for progress)
export function uploadBackupForImport(
  serverId: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const formData = new FormData()
    formData.append('file', file)

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
          reject(new Error(error.error || 'Upload failed'))
        } catch {
          reject(new Error('Upload failed'))
        }
      }
    })

    xhr.addEventListener('error', () => reject(new Error('Upload failed')))
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')))

    xhr.open('POST', `/api/servers/${serverId}/files/import/upload`)
    const token = useAuthStore.getState().token
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    }
    xhr.send(formData)
  })
}

export async function generateImportDiff(serverId: string, tempFileId: string): Promise<DiffResult> {
  const res = await fetch(`/api/servers/${serverId}/files/import/diff`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tempFileId }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to generate diff')
  }
  return res.json()
}

export async function applyImportChanges(
  serverId: string,
  tempFileId: string,
  selections: DiffSelection[]
): Promise<ApplyResult> {
  const res = await fetch(`/api/servers/${serverId}/files/import/apply`, {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tempFileId, selections }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to apply changes')
  }
  return res.json()
}

export async function cancelImport(serverId: string, tempFileId: string): Promise<void> {
  const res = await fetch(`/api/servers/${serverId}/files/import/${tempFileId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })
  if (!res.ok) throw new Error('Failed to cancel import')
}

// Nodes
export async function fetchNodes(): Promise<Node[]> {
  const res = await fetch('/api/nodes', {
    headers: getAuthHeaders(),
  })
  if (!res.ok) throw new Error('Failed to fetch nodes')
  const data = await res.json()
  return data.nodes
}

export async function fetchNode(id: string): Promise<Node> {
  const res = await fetch(`/api/nodes/${id}`, {
    headers: getAuthHeaders(),
  })
  if (!res.ok) throw new Error('Failed to fetch node')
  const data = await res.json()
  return data.node
}

export async function deleteNode(id: string): Promise<void> {
  const res = await fetch(`/api/nodes/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Failed to delete node')
  }
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

  async post<T = unknown>(url: string, body?: unknown, options?: { headers?: Record<string, string> }): Promise<{ data: T }> {
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
