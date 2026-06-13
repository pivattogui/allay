import { beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted so the (also-hoisted) vi.mock factories can reference these safely.
const mocks = vi.hoisted(() => {
  const channelHandlers = new Map<string, (payload: unknown) => void>()
  const joinReceive = vi.fn().mockReturnThis()
  const channelJoin = vi.fn(() => ({ receive: joinReceive }))
  const channelLeave = vi.fn()
  const channelOn = vi.fn((event: string, cb: (payload: unknown) => void) => {
    channelHandlers.set(event, cb)
  })
  const socketChannel = vi.fn(() => ({ on: channelOn, join: channelJoin, leave: channelLeave }))
  const socketConnect = vi.fn()
  const invalidateQueries = vi.fn()
  return { channelHandlers, channelJoin, channelLeave, channelOn, socketChannel, socketConnect, invalidateQueries }
})

const { channelHandlers, channelJoin, channelLeave, socketChannel, socketConnect, invalidateQueries } = mocks

vi.mock('phoenix', () => ({
  Socket: vi.fn(function (this: Record<string, unknown>) {
    this.channel = mocks.socketChannel
    this.connect = mocks.socketConnect
    this.onOpen = vi.fn()
    this.onClose = vi.fn()
    this.onError = vi.fn()
  }),
}))

vi.mock('../lib/queryClient', () => ({
  queryClient: { invalidateQueries: (...args: unknown[]) => mocks.invalidateQueries(...args) },
}))

import { Socket } from 'phoenix'
import { useWebSocketStore } from './webSocketStore'

describe('webSocketStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    channelHandlers.clear()
    useWebSocketStore.setState({
      socket: null,
      channel: null,
      isConnected: false,
      currentSubscription: null,
      invalidationTimeoutId: null,
      onLog: null,
      onMetrics: null,
      onStatus: null,
    })
  })

  it('builds the channel for the server topic and joins', () => {
    useWebSocketStore.getState().subscribe('srv-1', ['logs', 'metrics'])

    expect(Socket).toHaveBeenCalledWith('/socket', expect.objectContaining({ params: expect.any(Object) }))
    expect(socketConnect).toHaveBeenCalled()
    expect(socketChannel).toHaveBeenCalledWith('server:srv-1', {})
    expect(channelJoin).toHaveBeenCalled()
  })

  it('routes an incoming log event to onLog', () => {
    const onLog = vi.fn()
    useWebSocketStore.getState().setCallbacks({ onLog })
    useWebSocketStore.getState().subscribe('srv-1', ['logs'])

    const log = { timestamp: '2026-06-13T00:00:00Z', level: 'info', message: 'hello' }
    channelHandlers.get('log')?.(log)

    expect(onLog).toHaveBeenCalledWith(log)
  })

  it('invalidates server queries (debounced) on a terminal status', () => {
    vi.useFakeTimers()
    const onStatus = vi.fn()
    useWebSocketStore.getState().setCallbacks({ onStatus })
    useWebSocketStore.getState().subscribe('srv-1', ['status'])

    channelHandlers.get('status')?.({ state: 'stopped' })

    expect(onStatus).toHaveBeenCalledWith({ state: 'stopped' })
    expect(invalidateQueries).not.toHaveBeenCalled()

    vi.advanceTimersByTime(500)
    expect(invalidateQueries).toHaveBeenCalledTimes(1)
  })

  it('leaves the channel on unsubscribe', () => {
    useWebSocketStore.getState().subscribe('srv-1', ['logs'])
    useWebSocketStore.getState().unsubscribe()

    expect(channelLeave).toHaveBeenCalled()
    expect(useWebSocketStore.getState().channel).toBeNull()
    expect(useWebSocketStore.getState().currentSubscription).toBeNull()
  })
})
