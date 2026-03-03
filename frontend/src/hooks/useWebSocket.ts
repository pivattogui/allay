import { useEffect } from 'react'
import { useWebSocketStore, type LogEntry, type ServerMetrics, type ServerStatus } from '../stores'

interface UseWebSocketOptions {
  serverId: string
  channels: ('logs' | 'metrics' | 'status')[]
  onLog?: (log: LogEntry) => void
  onMetrics?: (metrics: ServerMetrics) => void
  onStatus?: (status: ServerStatus) => void
}

export function useWebSocket({ serverId, channels, onLog, onMetrics, onStatus }: UseWebSocketOptions) {
  const { isConnected, subscribe, setCallbacks } = useWebSocketStore()

  // Memoize channels string para evitar reconexões desnecessárias
  const channelsKey = channels.join(',')

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
  }, [serverId, channelsKey, subscribe, setCallbacks, onLog, onMetrics, onStatus])

  return { connected: isConnected }
}

// Re-export types for backward compatibility
export type { LogEntry, ServerMetrics, ServerStatus }
