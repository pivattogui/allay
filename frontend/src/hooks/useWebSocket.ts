import { useEffect } from 'react'
import { type LogEntry, type ServerMetrics, type ServerStatus, useWebSocketStore } from '../stores'

interface UseWebSocketOptions {
  serverId: string
  channels: ('logs' | 'metrics' | 'status')[]
  onLog?: (log: LogEntry) => void
  onMetrics?: (metrics: ServerMetrics) => void
  onStatus?: (status: ServerStatus) => void
}

export function useWebSocket({ serverId, channels, onLog, onMetrics, onStatus }: UseWebSocketOptions) {
  const { isConnected, subscribe, setCallbacks } = useWebSocketStore()

  useEffect(() => {
    // Define callbacks primeiro
    setCallbacks({ onLog, onMetrics, onStatus })

    // Inscreve no servidor (reutiliza conexão existente)
    subscribe(serverId, channels)

    // Cleanup: apenas limpa callbacks, NÃO desinscreve
    // A conexão é mantida globalmente
    return () => {
      setCallbacks({ onLog: undefined, onMetrics: undefined, onStatus: undefined })
    }
  }, [serverId, subscribe, setCallbacks, onLog, onMetrics, onStatus, channels])

  return { connected: isConnected }
}

// Re-export types for backward compatibility
export type { LogEntry, ServerMetrics, ServerStatus }
