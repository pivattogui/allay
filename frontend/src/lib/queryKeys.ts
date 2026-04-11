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