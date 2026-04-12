import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useBackups, useCreateBackup, useRestoreBackup, useDeleteBackup, useUpdateBackupConfig } from '@/hooks/useBackups'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import {
  Archive,
  Plus,
  RotateCcw,
  Trash2,
  Loader2,
  Download,
  MoreVertical
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

interface BackupSectionProps {
  serverId: string
}

function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  if (i < 0 || i >= sizes.length) return '0 B'
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(hours / 24)

  if (days > 7) {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    })
  } else if (days > 0) {
    return `${days}d ago`
  } else if (hours > 0) {
    return `${hours}h ago`
  } else {
    return 'Just now'
  }
}

function formatFullDate(dateString: string): string {
  return new Date(dateString).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function BackupSection({ serverId }: BackupSectionProps) {
  const { data, isLoading } = useBackups(serverId)
  const createBackupMutation = useCreateBackup(serverId)
  const restoreBackupMutation = useRestoreBackup(serverId)
  const deleteBackupMutation = useDeleteBackup(serverId)
  const updateConfigMutation = useUpdateBackupConfig(serverId)

  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const backups = data?.backups || []
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

  const handleCreateBackup = async () => {
    try {
      await createBackupMutation.mutateAsync('manual')
      toast.success('Backup created successfully')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create backup')
    }
  }

  const handleRestoreBackup = async (backupId: string, filename: string) => {
    if (!confirm(`Are you sure you want to restore backup "${filename}"? This will overwrite current server data.`)) {
      return
    }

    setActionLoading(backupId)
    try {
      await restoreBackupMutation.mutateAsync(backupId)
      toast.success('Backup restored successfully')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to restore backup')
    } finally {
      setActionLoading(null)
    }
  }

  const handleDeleteBackup = async (backupId: string, filename: string) => {
    if (!confirm(`Are you sure you want to delete backup "${filename}"? This action cannot be undone.`)) {
      return
    }

    setActionLoading(backupId)
    try {
      await deleteBackupMutation.mutateAsync(backupId)
      toast.success('Backup deleted successfully')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete backup')
    } finally {
      setActionLoading(null)
    }
  }

  const handleDownloadBackup = async (backupId: string, filename: string) => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/backups/${serverId}/${backupId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.ok) {
        const blob = await res.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        window.URL.revokeObjectURL(url)
        toast.success('Download started')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Download failed')
      }
    } catch (error) {
      toast.error('Failed to download backup file')
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4 pb-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-4">
      {/* Header Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium">Backup Configuration</h3>
          <Button
            onClick={handleCreateBackup}
            disabled={createBackupMutation.isPending}
            size="sm"
          >
            {createBackupMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Quick Backup
              </>
            )}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Backups are created automatically during version migration and can be manually triggered
        </p>
      </div>

      {/* Backup Settings */}
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

      {/* Recent Backups */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium">Recent Backups</h3>
          <span className="text-sm text-muted-foreground">
            {backups.length} total
          </span>
        </div>

        {backups.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Archive className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm font-medium mb-1">No backups yet</p>
              <p className="text-xs text-muted-foreground mb-4">
                Create your first backup to protect your server data
              </p>
              <Button onClick={handleCreateBackup} disabled={createBackupMutation.isPending} size="sm">
                {createBackupMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Backup
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {backups.slice(0, 5).map((backup) => (
              <Card key={backup.id}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted flex-shrink-0">
                        <Archive className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {backup.name}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{formatBytes(backup.size)}</span>
                          <span>·</span>
                          <span title={formatFullDate(backup.createdAt)}>
                            {formatDate(backup.createdAt)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          disabled={actionLoading === backup.id}
                        >
                          {actionLoading === backup.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <MoreVertical className="h-4 w-4" />
                          )}
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleDownloadBackup(backup.id, backup.name)}>
                          <Download className="mr-2 h-4 w-4" />
                          Download
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleRestoreBackup(backup.id, backup.name)}>
                          <RotateCcw className="mr-2 h-4 w-4" />
                          Restore
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => handleDeleteBackup(backup.id, backup.name)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            ))}
            {backups.length > 5 && (
              <p className="text-xs text-muted-foreground text-center pt-2">
                Showing 5 of {backups.length} backups
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
