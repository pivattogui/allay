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
} from '@/components/ui/dropdown-menu';
import { Archive, Plus, MoreVertical, RotateCcw, Trash2, Loader2, Download } from 'lucide-react';
import { toast } from 'sonner';

interface Backup {
  id: number;
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

interface BackupListProps {
  serverId: string;
  serverName: string;
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

export function BackupList({ serverId, serverName: _serverName }: BackupListProps) {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const fetchBackups = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/backups/${serverId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setBackups(data.backups || data || []);
      }
    } catch (err) {
      console.error('Failed to fetch backups:', err);
      toast.error('Failed to load backups');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();
  }, [serverId]);

  const createBackup = async () => {
    setCreating(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/backups/${serverId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        toast.success('Backup created successfully');
        fetchBackups();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to create backup');
      }
    } catch (err) {
      toast.error('Failed to create backup');
    } finally {
      setCreating(false);
    }
  };

  const restoreBackup = async (backupId: number) => {
    if (!confirm('Are you sure you want to restore this backup? This will overwrite current server data.')) {
      return;
    }

    setActionLoading(backupId);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/backups/${serverId}/${backupId}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        toast.success('Backup restored successfully');
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to restore backup');
      }
    } catch (err) {
      toast.error('Failed to restore backup');
    } finally {
      setActionLoading(null);
    }
  };

  const deleteBackup = async (backupId: number) => {
    if (!confirm('Are you sure you want to delete this backup?')) {
      return;
    }

    setActionLoading(backupId);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/backups/${serverId}/${backupId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        toast.success('Backup deleted successfully');
        fetchBackups();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to delete backup');
      }
    } catch (err) {
      toast.error('Failed to delete backup');
    } finally {
      setActionLoading(null);
    }
  };

  const downloadBackup = async (backupId: number, filename: string) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/backups/${serverId}/${backupId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
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
    } catch (err) {
      toast.error('Failed to download backup');
    }
  };

  if (loading) {
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
        <Button onClick={createBackup} disabled={creating}>
          {creating ? (
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
            onClick: createBackup,
          }}
        />
      ) : (
        <div className="space-y-3">
          {backups.map((backup) => (
            <Card key={backup.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                      <Archive className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{backup.filename}</p>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{formatBytes(backup.sizeBytes)}</span>
                        <span>·</span>
                        <span>{formatDate(backup.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  <DropdownMenu>
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
                      <DropdownMenuItem onClick={() => downloadBackup(backup.id, backup.filename)}>
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => restoreBackup(backup.id)}>
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Restore
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => deleteBackup(backup.id)}
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
        </div>
      )}
    </div>
  );
}
