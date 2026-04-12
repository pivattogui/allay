import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useBackups, useUpdateBackupConfig } from '@/hooks/useBackups'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

interface BackupSectionProps {
  serverId: string
}

export function BackupSection({ serverId }: BackupSectionProps) {
  const { data, isLoading } = useBackups(serverId)
  const updateConfigMutation = useUpdateBackupConfig(serverId)

  const config = data?.config || {
    enabled: true,
    intervalMinutes: 60,
    maxBackups: 10,
    includeLogs: false,
  }

  const [editEnabled, setEditEnabled] = useState(config.enabled)
  const [editInterval, setEditInterval] = useState(String(config.intervalMinutes))
  const [editMaxBackups, setEditMaxBackups] = useState(String(config.maxBackups))
  const [editIncludeLogs, setEditIncludeLogs] = useState(config.includeLogs)

  useEffect(() => {
    if (data?.config) {
      setEditEnabled(data.config.enabled)
      setEditInterval(String(data.config.intervalMinutes))
      setEditMaxBackups(String(data.config.maxBackups))
      setEditIncludeLogs(data.config.includeLogs)
    }
  }, [data?.config])

  const handleSaveConfig = async () => {
    try {
      await updateConfigMutation.mutateAsync({
        enabled: editEnabled,
        intervalMinutes: parseInt(editInterval, 10) || 60,
        maxBackups: parseInt(editMaxBackups, 10) || 10,
        includeLogs: editIncludeLogs,
      })
      toast.success('Backup configuration updated')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update config')
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4 pb-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-4">
      <div className="space-y-2">
        <h3 className="text-base font-medium">Backup Configuration</h3>
        <p className="text-sm text-muted-foreground">
          Configure automatic backup schedule and retention. Manage backups in the Backups tab.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="backup-enabled" className="text-sm font-medium">Automatic Backups</Label>
              <p className="text-xs text-muted-foreground">Schedule periodic backups automatically</p>
            </div>
            <Switch
              id="backup-enabled"
              checked={editEnabled}
              onCheckedChange={setEditEnabled}
            />
          </div>

          {editEnabled && (
            <div className="space-y-3 pt-2 border-t">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="interval" className="text-xs">Interval (minutes)</Label>
                  <Input
                    id="interval"
                    type="number"
                    min={5}
                    max={1440}
                    value={editInterval}
                    onChange={(e) => setEditInterval(e.target.value)}
                    disabled={updateConfigMutation.isPending}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="max-backups" className="text-xs">Max backups to keep</Label>
                  <Input
                    id="max-backups"
                    type="number"
                    min={1}
                    max={100}
                    value={editMaxBackups}
                    onChange={(e) => setEditMaxBackups(e.target.value)}
                    disabled={updateConfigMutation.isPending}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="include-logs" className="text-xs">Include logs</Label>
                  <p className="text-xs text-muted-foreground">Include server log files in backups</p>
                </div>
                <Switch
                  id="include-logs"
                  checked={editIncludeLogs}
                  onCheckedChange={setEditIncludeLogs}
                  disabled={updateConfigMutation.isPending}
                />
              </div>
            </div>
          )}

          <Button
            onClick={handleSaveConfig}
            disabled={updateConfigMutation.isPending}
            size="sm"
          >
            {updateConfigMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
