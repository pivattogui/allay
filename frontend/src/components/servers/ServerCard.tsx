import { Loader2, MoreVertical, Play, Square, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { Server } from '@/types/server'

interface ServerCardProps {
  server: Server
  pendingAction?: 'start' | 'stop' | 'delete'
  onAction: (serverId: string, action: 'start' | 'stop' | 'delete') => void
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

export function ServerCard({ server, pendingAction, onAction }: ServerCardProps) {
  const navigate = useNavigate()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const isRunning = server.status.state === 'running'
  const isBusy = server.status.state === 'starting' || server.status.state === 'stopping'
  const isLoading = !!pendingAction

  const handleAction = (e: React.MouseEvent, action: 'start' | 'stop' | 'delete') => {
    e.preventDefault()
    e.stopPropagation()
    onAction(server.id, action)
  }

  const handleCardClick = () => {
    navigate(`/servers/${server.id}`)
  }

  return (
    <>
      <Card
        className={cn(
          'group relative overflow-hidden transition-all cursor-pointer',
          isLoading ? 'opacity-75 pointer-events-none' : 'hover:border-muted-foreground/50',
        )}
        onClick={handleCardClick}
      >
        {isLoading && (
          <div className="absolute inset-0 bg-background/50 z-10 flex items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {pendingAction === 'start' && 'Starting server...'}
              {pendingAction === 'stop' && 'Stopping server...'}
              {pendingAction === 'delete' && 'Deleting server...'}
            </div>
          </div>
        )}
        <CardContent className="p-4">
          {/* Header */}
          <div className="flex items-start justify-between mb-3">
            <h3 className="font-medium text-foreground truncate">{server.name}</h3>
            <StatusBadge state={server.status.state} />
          </div>

          {/* Info */}
          <div className="text-sm text-muted-foreground mb-4">
            <span className="capitalize">{server.type}</span>
            <span className="mx-1.5">·</span>
            <span>{server.version}</span>
            <span className="mx-1.5">·</span>
            <span>:{server.port}</span>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
            <div>
              <span className="text-foreground font-medium">{server.ramMaxMb}</span> MB RAM
            </div>
            {server.status.uptime !== undefined && (
              <div>
                <span className="text-foreground font-medium">{formatUptime(server.status.uptime)}</span> uptime
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {isRunning ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={(e) => handleAction(e, 'stop')}
                disabled={isBusy || isLoading}
                className="flex-1"
              >
                {pendingAction === 'stop' ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Stopping...
                  </>
                ) : (
                  <>
                    <Square className="h-3.5 w-3.5 mr-1.5" />
                    Stop
                  </>
                )}
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={(e) => handleAction(e, 'start')}
                disabled={isBusy || isLoading}
                className="flex-1"
              >
                {pendingAction === 'start' ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 mr-1.5" />
                    Start
                  </>
                )}
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="secondary" size="sm" disabled={isLoading}>
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteDialogOpen(true)
                  }}
                  disabled={isRunning || isBusy || isLoading}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Server"
        description={`Are you sure you want to delete "${server.name}"? All server data, worlds, and configurations will be permanently lost.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
        loading={pendingAction === 'delete'}
        onConfirm={() => {
          onAction(server.id, 'delete')
        }}
      />
    </>
  )
}
