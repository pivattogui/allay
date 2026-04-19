import { useEffect, useRef } from 'react'
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

  const callbacksRef = useRef({ onLog, onMetrics, onStatus })
  callbacksRef.current = { onLog, onMetrics, onStatus }

  const channelsKey = channels.join(',')

  useEffect(() => {
    setCallbacks({
      onLog: (...args) => callbacksRef.current.onLog?.(...args),
      onMetrics: (...args) => callbacksRef.current.onMetrics?.(...args),
      onStatus: (...args) => callbacksRef.current.onStatus?.(...args),
    })

    subscribe(serverId, channels)

    return () => {
      setCallbacks({ onLog: undefined, onMetrics: undefined, onStatus: undefined })
    }
    // channelsKey is a stable string derived from channels array
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, channelsKey, subscribe, setCallbacks])

  return { connected: isConnected }
}

export type { LogEntry, ServerMetrics, ServerStatus }
