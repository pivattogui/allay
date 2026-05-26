import { Archive, ArrowLeft, FolderOpen, MoreVertical, Play, Settings, Square, Terminal, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BackupList } from '@/components/backups/BackupList'
import { ConsoleView } from '@/components/console/ConsoleView'
import { FileBrowser } from '@/components/files'
import { ServerSettingsTab } from '@/components/settings/ServerSettingsTab'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDeleteServer, useStartServer, useStopServer } from '@/hooks/useServerActions'
import { useServers } from '@/hooks/useServers'

export function ServerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const tab = searchParams.get('tab') || 'console'
  const { data: servers = [] } = useServers()
  const server = servers.find((s) => s.id === id)

  const startServer = useStartServer()
  const stopServer = useStopServer()
  const deleteServerMutation = useDeleteServer()

  const setTab = useCallback(
    (value: string) => {
      setSearchParams({ tab: value })
    },
    [setSearchParams],
  )

  const handleServerAction = (action: 'start' | 'stop' | 'delete') => {
    if (!server) return

    switch (action) {
      case 'start':
        startServer.mutate(server.id)
        break
      case 'stop':
        stopServer.mutate(server.id)
        break
      case 'delete':
        deleteServerMutation.mutate(server.id)
        navigate('/servers')
        break
    }
  }

  if (!server) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <h2 className="text-lg font-medium text-foreground">Server not found</h2>
          <p className="text-sm text-muted-foreground mt-1">The server you're looking for doesn't exist</p>
          <Button variant="secondary" className="mt-4" onClick={() => navigate('/servers')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to servers
          </Button>
        </div>
      </div>
    )
  }

  const isRunning = server.status.state === 'running'
  const isBusy = server.status.state === 'starting' || server.status.state === 'stopping'

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-border bg-background">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/servers')}
                  className="text-muted-foreground"
                >
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Servers
                </Button>
                <Separator orientation="vertical" className="h-6" />
                <div className="flex items-center gap-3">
                  <h1 className="text-lg font-semibold text-foreground">{server.name}</h1>
                  <StatusBadge state={server.status.state} />
                </div>
              </div>

              <div className="flex items-center gap-2">
                {isRunning ? (
                  <Button variant="secondary" size="sm" onClick={() => handleServerAction('stop')} disabled={isBusy}>
                    <Square className="h-4 w-4 mr-2" />
                    Stop
                  </Button>
                ) : (
                  <Button variant="default" size="sm" onClick={() => handleServerAction('start')} disabled={isBusy}>
                    <Play className="h-4 w-4 mr-2" />
                    Start
                  </Button>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="sm">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem className="text-muted-foreground">
                      <span className="capitalize">{server.type}</span>
                      <span className="mx-1.5">·</span>
                      <span>{server.version}</span>
                      <span className="mx-1.5">·</span>
                      <span>:{server.port}</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setDeleteDialogOpen(true)}
                      disabled={isRunning || isBusy}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete Server
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Tabs */}
            <Tabs value={tab} onValueChange={setTab} className="mt-4">
              <TabsList className="bg-transparent border-b-0 p-0 h-auto gap-4">
                <TabsTrigger
                  value="console"
                  className="bg-transparent border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent rounded-none px-1 pb-2"
                >
                  <Terminal className="h-4 w-4 mr-2" />
                  Console
                </TabsTrigger>
                <TabsTrigger
                  value="backups"
                  className="bg-transparent border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent rounded-none px-1 pb-2"
                >
                  <Archive className="h-4 w-4 mr-2" />
                  Backups
                </TabsTrigger>
                <TabsTrigger
                  value="files"
                  className="bg-transparent border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent rounded-none px-1 pb-2"
                >
                  <FolderOpen className="h-4 w-4 mr-2" />
                  Files
                </TabsTrigger>
                <TabsTrigger
                  value="settings"
                  className="bg-transparent border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent rounded-none px-1 pb-2"
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Settings
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          <Tabs value={tab} className="h-full">
            <TabsContent value="console" className="h-full m-0 p-0">
              <ConsoleView
                serverId={server.id}
                serverName={server.name}
                serverState={server.status.state}
                lastError={server.status.lastError}
              />
            </TabsContent>
            <TabsContent value="backups" className="h-full m-0 overflow-auto">
              <BackupList serverId={server.id} />
            </TabsContent>
            <TabsContent value="files" className="h-full m-0 overflow-hidden">
              <FileBrowser serverId={server.id} serverName={server.name} />
            </TabsContent>
            <TabsContent value="settings" className="h-full m-0 overflow-auto">
              <ServerSettingsTab serverId={server.id} isRunning={isRunning} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Server"
        description={`Are you sure you want to delete "${server.name}"? All server data, worlds, and configurations will be permanently lost.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={() => handleServerAction('delete')}
      />
    </>
  )
}
