import { describe, expect, it } from 'vitest'
import { buildBackendSocketUrl, buildBackendUrl } from './backend'

describe('backend URLs', () => {
  it('keeps relative URLs when no backend origin is configured', () => {
    expect(buildBackendUrl('', '/api/servers')).toBe('/api/servers')
    expect(buildBackendSocketUrl('')).toBe('/socket')
  })

  it('builds cross-origin HTTP and WebSocket URLs', () => {
    expect(buildBackendUrl('https://api.allay.example/', '/api/servers')).toBe('https://api.allay.example/api/servers')
    expect(buildBackendSocketUrl('https://api.allay.example')).toBe('wss://api.allay.example/socket')
    expect(buildBackendSocketUrl('http://localhost:4000')).toBe('ws://localhost:4000/socket')
  })
})
