import { type Channel as PhoenixChannel, Socket } from 'phoenix'
import { create } from 'zustand'
import { queryClient } from '../lib/queryClient'
import { serverKeys } from '../lib/queryKeys'
import { useAuthStore } from './authStore'

export interface LogEntry {
  timestamp: string
  level: string
  message: string
}

export interface ServerMetrics {
  timestamp: string
  ramUsedMb: number
  ramMaxMb: number
  cpuPercent: number
  playerCount: number
  playerMax: number
}

export interface ServerStatus {
  state: string
  pid?: number
  uptime?: number
  lastError?: string
}

// Kept for API compatibility with useWebSocket; phoenix delivers all event
// types on a single topic, so the selection is no longer wire-significant.
type Channel = 'logs' | 'metrics' | 'status'

// Terminal states that justify a server-list invalidation.
const TERMINAL_STATES = ['running', 'stopped', 'crashed'] as const

interface WebSocketState {
  socket: Socket | null
  channel: PhoenixChannel | null
  isConnected: boolean
  currentSubscription: { serverId: string; channels: Channel[] } | null
  invalidationTimeoutId: ReturnType<typeof setTimeout> | null

  // Callbacks for consumers
  onLog: ((log: LogEntry) => void) | null
  onMetrics: ((metrics: ServerMetrics) => void) | null
  onStatus: ((status: ServerStatus) => void) | null

  // Actions
  subscribe: (serverId: string, channels: Channel[]) => void
  unsubscribe: () => void
  setCallbacks: (callbacks: {
    onLog?: (log: LogEntry) => void
    onMetrics?: (metrics: ServerMetrics) => void
    onStatus?: (status: ServerStatus) => void
  }) => void
}

// Builds (once) the shared phoenix Socket. The token is read at build time;
// a re-login mid-session would need a reconnect, which is acceptable because
// login navigates/reloads the app.
function ensureSocket(get: () => WebSocketState, set: (partial: Partial<WebSocketState>) => void): Socket {
  const existing = get().socket
  if (existing) return existing

  const token = useAuthStore.getState().token
  const socket = new Socket('/socket', { params: { token } })
  socket.onOpen(() => set({ isConnected: true }))
  socket.onClose(() => set({ isConnected: false }))
  socket.onError(() => set({ isConnected: false }))
  socket.connect()

  set({ socket })
  return socket
}

export const useWebSocketStore = create<WebSocketState>()((set, get) => ({
  socket: null,
  channel: null,
  isConnected: false,
  currentSubscription: null,
  invalidationTimeoutId: null,
  onLog: null,
  onMetrics: null,
  onStatus: null,

  setCallbacks: (callbacks) => {
    set({
      onLog: callbacks.onLog ?? null,
      onMetrics: callbacks.onMetrics ?? null,
      onStatus: callbacks.onStatus ?? null,
    })
  },

  // Joins the per-server topic. The backend pushes a status snapshot + last-50
  // log replay on join; those arrive as normal "status"/"log" events.
  subscribe: (serverId: string, channels: Channel[]) => {
    const socket = ensureSocket(get, set)

    const previous = get().channel
    if (previous) {
      previous.leave()
    }

    const channel = socket.channel(`server:${serverId}`, {})

    channel.on('log', (log: LogEntry) => {
      get().onLog?.(log)
    })

    channel.on('metrics', (metrics: ServerMetrics) => {
      get().onMetrics?.(metrics)
    })

    channel.on('status', (status: ServerStatus) => {
      get().onStatus?.(status)

      if (TERMINAL_STATES.includes(status.state as (typeof TERMINAL_STATES)[number])) {
        const pending = get().invalidationTimeoutId
        if (pending) clearTimeout(pending)
        const timeoutId = setTimeout(() => {
          queryClient.invalidateQueries({
            queryKey: serverKeys.all,
            refetchType: 'active',
          })
          set({ invalidationTimeoutId: null })
        }, 500)
        set({ invalidationTimeoutId: timeoutId })
      }
    })

    channel.join().receive('ok', () => set({ isConnected: true }))

    set({ channel, currentSubscription: { serverId, channels } })
  },

  unsubscribe: () => {
    const channel = get().channel
    if (channel) {
      channel.leave()
    }
    set({ channel: null, currentSubscription: null })
  },
}))
