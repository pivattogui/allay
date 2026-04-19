import { create } from 'zustand'
import { queryClient } from '../lib/queryClient'
import { serverKeys } from '../lib/queryKeys'

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

type Channel = 'logs' | 'metrics' | 'status'

interface WSMessage {
  type: 'log' | 'metrics' | 'status' | 'subscribed' | 'unsubscribed' | 'error'
  serverId?: string
  data?: LogEntry | ServerMetrics | ServerStatus
  channels?: string[]
  message?: string
}

// Estados terminais que justificam invalidação
const TERMINAL_STATES = ['running', 'stopped', 'crashed'] as const

interface WebSocketState {
  ws: WebSocket | null
  isConnected: boolean
  isReconnecting: boolean
  currentSubscription: { serverId: string; channels: Channel[] } | null
  reconnectTimeoutId: ReturnType<typeof setTimeout> | null
  invalidationTimeoutId: ReturnType<typeof setTimeout> | null

  // Callbacks for consumers
  onLog: ((log: LogEntry) => void) | null
  onMetrics: ((metrics: ServerMetrics) => void) | null
  onStatus: ((status: ServerStatus) => void) | null

  // Actions
  ensureConnection: () => void
  subscribe: (serverId: string, channels: Channel[]) => void
  unsubscribe: () => void
  setCallbacks: (callbacks: {
    onLog?: (log: LogEntry) => void
    onMetrics?: (metrics: ServerMetrics) => void
    onStatus?: (status: ServerStatus) => void
  }) => void
  sendCommand: (command: string) => void
}

export const useWebSocketStore = create<WebSocketState>()((set, get) => ({
  ws: null,
  isConnected: false,
  isReconnecting: false,
  currentSubscription: null,
  reconnectTimeoutId: null,
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

  // Garante que existe uma conexão WebSocket (cria se não existir)
  ensureConnection: () => {
    const state = get()

    // Já conectado ou conectando
    if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    // Limpa timeout de reconexão anterior
    if (state.reconnectTimeoutId) {
      clearTimeout(state.reconnectTimeoutId)
      set({ reconnectTimeoutId: null })
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws`

    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      const currentState = get()
      set({ isConnected: true, isReconnecting: false })

      // Se já tinha uma subscrição pendente, reenvia
      if (currentState.currentSubscription) {
        ws.send(
          JSON.stringify({
            type: 'subscribe',
            serverId: currentState.currentSubscription.serverId,
            channels: currentState.currentSubscription.channels,
          }),
        )
      }
    }

    ws.onmessage = (event) => {
      const currentState = get()

      try {
        const message: WSMessage = JSON.parse(event.data)

        switch (message.type) {
          case 'log':
            if (message.data && currentState.onLog) {
              currentState.onLog(message.data as LogEntry)
            }
            break

          case 'metrics':
            if (message.data && currentState.onMetrics) {
              currentState.onMetrics(message.data as ServerMetrics)
            }
            break

          case 'status': {
            if (message.data && currentState.onStatus) {
              currentState.onStatus(message.data as ServerStatus)
            }

            // Invalidate queries for terminal states
            const status = message.data as ServerStatus
            if (TERMINAL_STATES.includes(status.state as (typeof TERMINAL_STATES)[number])) {
              if (currentState.invalidationTimeoutId) {
                clearTimeout(currentState.invalidationTimeoutId)
              }
              const timeoutId = setTimeout(() => {
                queryClient.invalidateQueries({
                  queryKey: serverKeys.all,
                  refetchType: 'active',
                })
                set({ invalidationTimeoutId: null })
              }, 500)
              set({ invalidationTimeoutId: timeoutId })
            }
            break
          }
        }
      } catch (_err) {}
    }

    ws.onclose = () => {
      set({ isConnected: false, ws: null })

      // Reconecta após 3 segundos
      const timeoutId = setTimeout(() => {
        set({ isReconnecting: true })
        get().ensureConnection()
      }, 3000)

      set({ reconnectTimeoutId: timeoutId })
    }

    ws.onerror = (_err) => {}

    set({ ws })
  },

  // Muda a subscrição para um servidor específico (reutiliza conexão existente)
  subscribe: (serverId: string, channels: Channel[]) => {
    // Garante que existe conexão
    get().ensureConnection()

    // Pega estado APÓS ensureConnection (pode ter criado novo ws)
    const state = get()

    // Atualiza subscrição no estado
    set({ currentSubscription: { serverId, channels } })

    // Se WebSocket está aberto, envia subscribe (sempre envia para receber dados atuais)
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(
        JSON.stringify({
          type: 'subscribe',
          serverId,
          channels,
        }),
      )
    }
    // Se ainda está conectando, o onopen vai enviar o subscribe
  },

  // Remove a subscrição atual (não fecha a conexão)
  unsubscribe: () => {
    const state = get()

    if (state.ws && state.ws.readyState === WebSocket.OPEN && state.currentSubscription) {
      state.ws.send(
        JSON.stringify({
          type: 'unsubscribe',
          serverId: state.currentSubscription.serverId,
          channels: state.currentSubscription.channels,
        }),
      )
    }

    set({ currentSubscription: null })
  },

  sendCommand: (command: string) => {
    const state = get()
    if (state.ws && state.ws.readyState === WebSocket.OPEN && state.currentSubscription) {
      state.ws.send(
        JSON.stringify({
          type: 'command',
          serverId: state.currentSubscription.serverId,
          command,
        }),
      )
    }
  },
}))
