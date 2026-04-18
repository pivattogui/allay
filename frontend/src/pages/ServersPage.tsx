import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ServerCard } from '@/components/servers/ServerCard'
import { EmptyState } from '@/components/shared/EmptyState'
import { LoadingState } from '@/components/shared/LoadingState'
import { Server, Plus } from 'lucide-react'
import { useServers } from '@/hooks/useServers'
import { useUIStore } from '@/stores'
import { useStartServer, useStopServer, useDeleteServer } from '@/hooks/useServerActions'

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

  const runningCount = servers.filter((s) => s.status.state === 'running').length

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
          <h1 className="text-2xl font-semibold text-foreground">Servers</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {servers.length} server{servers.length !== 1 ? 's' : ''}
            {runningCount > 0 && <> · <span className="text-green-500">{runningCount} running</span></>}
          </p>
        </div>
        <Button onClick={() => navigate('/servers/new')}>
          <Plus className="h-4 w-4 mr-2" />
          New Server
        </Button>
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
