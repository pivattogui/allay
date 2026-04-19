import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { useServers } from './useServers'

const mockServers = [{ id: '1', name: 'Test Server', type: 'vanilla', version: '1.21', port: 25565 }]

const server = setupServer(
  http.get('/api/servers', () => {
    return HttpResponse.json({ servers: mockServers })
  }),
)

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  })

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useServers', () => {
  it('fetches servers list', async () => {
    const { result } = renderHook(() => useServers(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(mockServers)
  })

  it('handles server error', async () => {
    server.use(
      http.get('/api/servers', () => {
        return new HttpResponse(null, { status: 500 })
      }),
    )

    const { result } = renderHook(() => useServers(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
