import { useEffect, useState } from 'react'
import type { LogEntry } from '@/types/server'

interface ServerStateBannerProps {
  serverState: string
  lastError?: string
  logs: LogEntry[]
}

const ERROR_CLASS_PATTERNS: RegExp[] = [
  /OutOfMemoryError/,
  /BindException/,
  /CrashReport/,
  /ClassNotFoundException/,
  /NoSuchMethodError/,
  /UnsupportedClassVersionError/,
  /PermGen space/,
]

function parseCrashSummary(logs: LogEntry[], lastError: string): string {
  const codeMatch = lastError.match(/code (\d+)/)
  const exitCode = codeMatch ? codeMatch[1] : '?'

  const errorLogs = logs.filter((l) => l.level === 'ERROR').slice(-20)
  for (const log of errorLogs) {
    for (const pattern of ERROR_CLASS_PATTERNS) {
      const match = log.message.match(pattern)
      if (match) return `exit code ${exitCode} \u2014 ${match[0]}`
    }
  }

  return `exit code ${exitCode}`
}

export function ServerStateBanner({ serverState, lastError, logs }: ServerStateBannerProps) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (serverState !== 'starting') {
      setElapsed(0)
      return
    }

    setElapsed(0)
    const interval = setInterval(() => {
      setElapsed((prev) => prev + 1)
    }, 1000)

    return () => clearInterval(interval)
  }, [serverState])

  if (serverState === 'starting') {
    return (
      <div
        className="flex-shrink-0 border-b px-4 py-2.5 flex items-center gap-2.5"
        style={{
          background: 'hsl(38 40% 8%)',
          borderColor: 'hsl(38 40% 18%)',
        }}
      >
        <span className="h-2 w-2 rounded-full flex-shrink-0 status-pulse" style={{ background: 'hsl(38 92% 50%)' }} />
        <span className="text-sm font-medium" style={{ color: 'hsl(38 92% 50%)' }}>
          Starting server
        </span>
        <span className="ml-auto text-xs tabular-nums console-text text-muted-foreground">{elapsed}s</span>
      </div>
    )
  }

  if (serverState === 'crashed') {
    const summary = lastError ? parseCrashSummary(logs, lastError) : null

    return (
      <div
        className="flex-shrink-0 border-b px-4 py-2.5 flex items-center gap-2.5"
        style={{
          background: 'hsl(0 30% 8%)',
          borderColor: 'hsl(0 40% 18%)',
        }}
      >
        <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: 'hsl(0 84% 60%)' }} />
        <span className="text-sm font-medium" style={{ color: 'hsl(0 84% 60%)' }}>
          Server crashed
        </span>
        {summary && <span className="text-xs text-muted-foreground">{summary}</span>}
      </div>
    )
  }

  return null
}
