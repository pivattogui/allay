export const serverKeys = {
  all: ['servers'] as const,
  detail: (id: string) => ['servers', id] as const,
  backups: (id: string) => ['servers', id, 'backups'] as const,
  properties: (id: string) => ['servers', id, 'properties'] as const,
}

export const authKeys = {
  status: ['auth', 'status'] as const,
  me: ['auth', 'me'] as const,
}

export const importKeys = {
  all: ['import'] as const,
  metadata: (tempFileId: string) => ['import', tempFileId, 'metadata'] as const,
  diff: (tempFileId: string, serverId: string) => ['import', tempFileId, 'diff', serverId] as const,
  portCheck: (port: number) => ['import', 'port', port] as const,
}
