import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Archive, Plus, MoreVertical, RotateCcw, Trash2, Loader2, Download } from 'lucide-react';
import { toast } from 'sonner';
import { useBackups, useCreateBackup, useRestoreBackup, useDeleteBackup } from '@/hooks/useBackups';
import { useAuthStore } from '@/stores';

interface BackupListProps {
  serverId: string;
}

function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  if (i < 0 || i >= sizes.length) return '0 B';
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString();
}

export function BackupList({ serverId }: BackupListProps) {
  const [pollInterval, setPollInterval] = useState<number | undefined>(undefined);
  const { data, isLoading } = useBackups(serverId, pollInterval);
  const createBackupMutation = useCreateBackup(serverId);
  const restoreBackupMutation = useRestoreBackup(serverId);
  const deleteBackupMutation = useDeleteBackup(serverId);

  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const backups = data?.backups || [];
  const hasPending = backups.some(b => b.status === 'pending');

  useEffect(() => {
    setPollInterval(hasPending ? 3000 : undefined);
  }, [hasPending]);

  const handleCreateBackup = () => {
    createBackupMutation.mutate('manual');
  };

  const handleRestoreBackup = async (backupId: string, filename: string) => {
    if (!confirm(`Are you sure you want to restore backup "${filename}"? This will overwrite current server data.`)) {
      return;
    }

    setActionLoading(backupId);
    try {
      await restoreBackupMutation.mutateAsync(backupId);
      toast.success('Backup restored successfully');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to restore backup');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteBackup = async (backupId: string, filename: string) => {
    if (!confirm(`Are you sure you want to delete backup "${filename}"?`)) {
      return;
    }

    setActionLoading(backupId);
    try {
      await deleteBackupMutation.mutateAsync(backupId);
      toast.success('Backup deleted successfully');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete backup');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDownloadBackup = async (backupId: string, filename: string) => {
    try {
      const token = useAuthStore.getState().token;
      const res = await fetch(`/api/backups/${serverId}/${backupId}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to download backup');
      }
    } catch {
      toast.error('Failed to download backup');
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-foreground">Backups</h2>
          <p className="text-sm text-muted-foreground">
            {backups.length} backup{backups.length !== 1 ? 's' : ''} available
          </p>
        </div>
        <Button onClick={handleCreateBackup} disabled={createBackupMutation.isPending}>
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
      </div>

      {/* Backup List */}
      {backups.length === 0 ? (
        <EmptyState
          icon={Archive}
          title="No backups yet"
          description="Create your first backup to protect your server data"
          action={{
            label: 'Create Backup',
            onClick: handleCreateBackup,
          }}
        />
      ) : (
        <div className="space-y-3">
          {backups.map((backup) => (
            <Card key={backup.id} className={backup.status === 'pending' ? 'opacity-70' : undefined}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                      {backup.status === 'pending' ? (
                        <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
                      ) : (
                        <Archive className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground">{backup.filename}</p>
                        {backup.status === 'pending' && (
                          <Badge variant="outline" className="text-xs">Creating...</Badge>
                        )}
                        {backup.status === 'failed' && (
                          <Badge variant="destructive" className="text-xs">Failed</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        {backup.status === 'completed' && <span>{formatBytes(backup.sizeBytes)}</span>}
                        {backup.status === 'completed' && <span>·</span>}
                        <span>{formatDate(backup.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  {backup.status === 'completed' && <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={actionLoading === backup.id}
                      >
                        {actionLoading === backup.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <MoreVertical className="h-4 w-4" />
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleDownloadBackup(backup.id, backup.filename)}>
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleRestoreBackup(backup.id, backup.filename)}>
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Restore
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => handleDeleteBackup(backup.id, backup.filename)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
