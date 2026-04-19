import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useJavaVersions, useRefreshJavaVersions } from '@/hooks/useJavaVersions'
import { useMinecraftVersions } from '@/hooks/useMinecraftVersions'
import { type ServerConfig, useUpdateServerConfig } from '@/hooks/useServerConfig'
import { useVersionMigration } from '@/hooks/useVersionMigration'

interface VersionSectionProps {
  serverId: string
  config: ServerConfig
  isRunning: boolean
}

export function VersionSection({ serverId, config, isRunning }: VersionSectionProps) {
  const [selectedType, setSelectedType] = useState<'vanilla' | 'paper'>(config.type)
  const [selectedVersion, setSelectedVersion] = useState(config.version)
  const [selectedJava, setSelectedJava] = useState(config.javaPath || '')
  const [showMigrationDialog, setShowMigrationDialog] = useState(false)
  const { toast } = useToast()

  const { data: javaVersions = [], isLoading: loadingJava } = useJavaVersions()
  const refreshJava = useRefreshJavaVersions()
  const { data: versions = [], isLoading: loadingVersions, isError: versionsError } = useMinecraftVersions(selectedType)
  const migrate = useVersionMigration(serverId)
  const updateConfig = useUpdateServerConfig(serverId)

  const hasVersionChange = selectedType !== config.type || selectedVersion !== config.version
  const hasJavaChange = selectedJava !== (config.javaPath || '')

  const handleMigrate = async () => {
    try {
      const result = await migrate.mutateAsync({
        type: selectedType,
        version: selectedVersion,
      })
      toast({
        title: 'Migration successful',
        description: `Backup created: ${result.backupId}`,
      })
      setShowMigrationDialog(false)
    } catch {
      toast({ title: 'Migration failed', variant: 'destructive' })
    }
  }

  const handleSaveJava = async () => {
    try {
      await updateConfig.mutateAsync({
        javaPath: selectedJava || null,
      })
      toast({ title: 'Java path updated successfully' })
    } catch {
      toast({ title: 'Failed to update Java path', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-6 pb-4">
      {/* Current Version */}
      <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
        <div>
          <span className="text-sm text-muted-foreground">Current Version</span>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className="capitalize">
              {config.type}
            </Badge>
            <span className="font-medium">{config.version}</span>
          </div>
        </div>
      </div>

      {/* Version Migration */}
      <div className="space-y-4">
        <Label>Change Server Version</Label>

        {isRunning && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>Server must be stopped before migrating to a new version</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Server Type</Label>
            <Select
              value={selectedType}
              onValueChange={(v) => {
                setSelectedType(v as 'vanilla' | 'paper')
                setSelectedVersion('')
              }}
              disabled={isRunning}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vanilla">Vanilla</SelectItem>
                <SelectItem value="paper">Paper</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Version</Label>
            <Select value={selectedVersion} onValueChange={setSelectedVersion} disabled={isRunning || loadingVersions}>
              <SelectTrigger>
                <SelectValue placeholder={loadingVersions ? 'Loading...' : 'Select version'} />
              </SelectTrigger>
              <SelectContent>
                {loadingVersions ? (
                  <SelectItem value="_loading" disabled>
                    Loading versions...
                  </SelectItem>
                ) : versionsError ? (
                  <SelectItem value="_error" disabled>
                    Failed to load versions
                  </SelectItem>
                ) : versions.length === 0 ? (
                  <SelectItem value="_empty" disabled>
                    No versions available
                  </SelectItem>
                ) : (
                  versions.slice(0, 20).map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          onClick={() => setShowMigrationDialog(true)}
          disabled={!hasVersionChange || !selectedVersion || isRunning}
        >
          Migrate Version
        </Button>
      </div>

      {/* Java Version */}
      <div className="space-y-4 pt-4 border-t">
        <div className="flex items-center justify-between">
          <Label>Java Runtime</Label>
          <Button variant="ghost" size="sm" onClick={() => refreshJava.mutate()} disabled={refreshJava.isPending}>
            {refreshJava.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Refresh</span>
          </Button>
        </div>

        <div className="space-y-2">
          <Select
            value={selectedJava || '_system'}
            onValueChange={(v) => setSelectedJava(v === '_system' ? '' : v)}
            disabled={loadingJava}
          >
            <SelectTrigger>
              <SelectValue placeholder={loadingJava ? 'Detecting Java...' : 'System default (java)'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_system">System default (java)</SelectItem>
              {javaVersions.map((jv) => (
                <SelectItem key={jv.path} value={jv.path}>
                  {jv.vendor ? `${jv.vendor} ` : ''}
                  {jv.version}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedJava && (
            <Input
              value={selectedJava}
              onChange={(e) => setSelectedJava(e.target.value)}
              placeholder="/path/to/java"
              className="font-mono text-sm"
            />
          )}

          <p className="text-xs text-muted-foreground">Select a detected Java version or enter a custom path</p>
        </div>

        <Button onClick={handleSaveJava} disabled={!hasJavaChange || updateConfig.isPending}>
          {updateConfig.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Save Java Path
        </Button>
      </div>

      {/* Migration Dialog */}
      <Dialog open={showMigrationDialog} onOpenChange={setShowMigrationDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Version Migration</DialogTitle>
            <DialogDescription>
              This will create a backup and then update the server to the new version.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                A backup will be created automatically before migration. You can restore from this backup if anything
                goes wrong.
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">From:</span>
                <p className="font-medium capitalize">
                  {config.type} {config.version}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">To:</span>
                <p className="font-medium capitalize">
                  {selectedType} {selectedVersion}
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMigrationDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleMigrate} disabled={migrate.isPending}>
              {migrate.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Migrating...
                </>
              ) : (
                'Migrate Now'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
