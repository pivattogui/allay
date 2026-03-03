import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ServerCard } from '@/components/servers/ServerCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { LoadingState } from '@/components/shared/LoadingState'
import { Server, Plus, Activity, HardDrive, Clock } from 'lucide-react'
import { useServers } from '@/hooks/useServers'
import { useUIStore } from '@/stores'
import { useStartServer, useStopServer, useDeleteServer } from '@/hooks/useServerActions'
import type { Server as ServerType } from '@/types/server'

function formatTotalUptime(servers: ServerType[]): string {
  const runningServers = servers.filter((s) => s.status.state === 'running')
  if (runningServers.length === 0) return '0h'

  const totalSeconds = runningServers.reduce((acc, s) => acc + (s.status.uptime || 0), 0)
  const hours = Math.floor(totalSeconds / 3600)
  return `${hours}h`
}

function formatTotalRam(servers: ServerType[]): string {
  const totalMb = servers.reduce((acc, s) => acc + s.ramMaxMb, 0)
  if (totalMb >= 1024) {
    return `${(totalMb / 1024).toFixed(1)} GB`
  }
  return `${totalMb} MB`
}

export function ServersPage() {
  const navigate = useNavigate()
  const { data: servers = [], isLoading } = useServers()
  const pendingActions = useUIStore((s) => s.pendingActions)
  const startServer = useStartServer()
  const stopServer = useStopServer()
  const deleteServer = useDeleteServer()

  const handleServerAction = (serverId: string, action: 'start' | 'stop' | 'delete') => {
    switch (action) {
      case 'start':
        startServer.mutate(serverId)
        break
      case 'stop':
        stopServer.mutate(serverId)
        break
      case 'delete':
        deleteServer.mutate(serverId)
        break
    }
  }

  const runningServers = servers.filter((s) => s.status.state === 'running')

  if (isLoading) {
    return (
      <div className="p-6">
        <LoadingState type="page" count={3} />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Overview</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your Minecraft servers</p>
        </div>
        <Button onClick={() => navigate('/servers/new')}>
          <Plus className="h-4 w-4 mr-2" />
          New Server
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                <Server className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{servers.length}</p>
                <p className="text-xs text-muted-foreground">Total Servers</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                <Activity className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{runningServers.length}</p>
                <p className="text-xs text-muted-foreground">Running</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                <HardDrive className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{formatTotalRam(servers)}</p>
                <p className="text-xs text-muted-foreground">Total RAM</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                <Clock className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-2xl font-semibold">{formatTotalUptime(servers)}</p>
                <p className="text-xs text-muted-foreground">Combined Uptime</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Servers Grid */}
      {servers.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No servers yet"
          description="Create your first Minecraft server to get started"
          action={{
            label: 'Create Server',
            onClick: () => navigate('/servers/new'),
          }}
        />
      ) : (
        <div>
          <h2 className="text-lg font-medium text-foreground mb-4">Servers</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {servers.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                pendingAction={pendingActions[server.id]}
                onAction={handleServerAction}
              />
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
