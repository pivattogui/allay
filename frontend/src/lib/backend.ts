const configuredBackendOrigin = import.meta.env.VITE_BACKEND_URL ?? ''

export function buildBackendUrl(backendOrigin: string, path: string): string {
  return `${backendOrigin.replace(/\/+$/, '')}${path}`
}

export function buildBackendSocketUrl(backendOrigin: string): string {
  if (!backendOrigin) return '/socket'

  const socketUrl = new URL('/socket', backendOrigin)
  socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  return socketUrl.toString()
}

export function backendUrl(path: string): string {
  return buildBackendUrl(configuredBackendOrigin, path)
}

export function backendFetch(path: string, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(backendUrl(path), init)
}

export function backendSocketUrl(): string {
  return buildBackendSocketUrl(configuredBackendOrigin)
}
