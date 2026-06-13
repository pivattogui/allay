import { ChevronDown, ChevronUp, Send, Wifi, WifiOff } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ServerStateBanner } from '@/components/console/ServerStateBanner'
import { MetricsChart } from '@/components/MetricsChart'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { type LogEntry, type ServerMetrics, useWebSocket } from '@/hooks/useWebSocket'
import { sendCommand as sendCommandApi } from '@/lib/api'
import { cn } from '@/lib/utils'

interface ConsoleViewProps {
  serverId: string
  serverName: string
  serverState: string
  lastError?: string
}

export function ConsoleView({ serverId, serverName: _serverName, serverState, lastError }: ConsoleViewProps) {
  const isRunning = serverState === 'running'
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [metricsHistory, setMetricsHistory] = useState<ServerMetrics[]>([])
  const [command, setCommand] = useState('')
  const [showMetrics, setShowMetrics] = useState(true)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const logsContainerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  const handleLog = useCallback((log: LogEntry) => {
    setLogs((prev) => {
      const newLogs = [...prev, log]
      if (newLogs.length > 500) {
        return newLogs.slice(-500)
      }
      return newLogs
    })
  }, [])

  const handleMetrics = useCallback((m: ServerMetrics) => {
    setMetricsHistory((prev) => {
      const newHistory = [...prev, m]
      if (newHistory.length > 60) {
        return newHistory.slice(-60)
      }
      return newHistory
    })
  }, [])

  const { connected } = useWebSocket({
    serverId,
    channels: ['logs', 'metrics'],
    onLog: handleLog,
    onMetrics: handleMetrics,
  })

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [autoScroll])

  const handleScroll = () => {
    if (!logsContainerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50
    setAutoScroll(isAtBottom)
  }

  const sendCommand = async () => {
    if (!command.trim()) return

    try {
      await sendCommandApi(serverId, command.trim())
      setCommand('')
    } catch (_err) {}
  }

  const getLogLevelColor = (level: string) => {
    switch (level.toLowerCase()) {
      case 'error':
        return 'text-red-400'
      case 'warn':
        return 'text-yellow-400'
      case 'info':
        return 'text-blue-400'
      default:
        return 'text-muted-foreground'
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Metrics Section */}
      <div className="flex-shrink-0 border-b border-border">
        <button
          onClick={() => setShowMetrics(!showMetrics)}
          className="w-full px-6 py-3 flex items-center justify-between text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <span>Server Metrics</span>
          {showMetrics ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {showMetrics && (
          <div className="px-6 pb-4">
            <Card className="bg-card/50">
              <CardContent className="p-4">
                <MetricsChart history={metricsHistory} maxPoints={30} isRunning={isRunning} />
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Server State Banner */}
      <ServerStateBanner serverState={serverState} lastError={lastError} logs={logs} />

      {/* Console Output */}
      <div className="flex-1 min-h-0 px-6 py-4">
        <div
          ref={logsContainerRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto bg-black rounded-lg p-4 console-text text-sm"
        >
          {serverState === 'stopped' || serverState === 'stopping' ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">Server is not running</div>
          ) : logs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">Waiting for logs...</div>
          ) : (
            <div className="space-y-0.5">
              {logs.map((log, i) => (
                <div key={i} className="flex gap-3 hover:bg-white/5 px-1 -mx-1 rounded">
                  <span className="text-muted-foreground flex-shrink-0 tabular-nums">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span className={cn(getLogLevelColor(log.level), 'flex-shrink-0 uppercase w-12')}>[{log.level}]</span>
                  <span className="text-gray-200 break-all">{log.message}</span>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Command Input */}
      <div className="flex-shrink-0 px-6 pb-4">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {connected ? (
              <>
                <Wifi className="h-3.5 w-3.5 text-green-500" />
                <span>Connected</span>
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5 text-red-500" />
                <span>Disconnected</span>
              </>
            )}
          </div>
          <div className="flex-1 flex gap-2">
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendCommand()}
              placeholder={isRunning ? 'Enter command (e.g., list, say Hello)...' : 'Server is not running'}
              className="console-text"
              disabled={!isRunning}
            />
            <Button onClick={sendCommand} disabled={!command.trim() || !isRunning}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
