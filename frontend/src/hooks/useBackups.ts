import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchBackups, createBackup, restoreBackup, deleteBackup, updateBackupConfig } from '../lib/api'
import { serverKeys } from '../lib/queryKeys'

export function useBackups(serverId: string, refetchInterval?: number) {
  return useQuery({
    queryKey: serverKeys.backups(serverId),
    queryFn: () => fetchBackups(serverId),
    enabled: !!serverId,
    refetchInterval: refetchInterval,
  })
}

export function useCreateBackup(serverId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (name: string) => createBackup(serverId, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serverKeys.backups(serverId) })
    },
  })
}

export function useRestoreBackup(serverId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (backupId: string) => restoreBackup(serverId, backupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serverKeys.all })
    },
  })
}

export function useDeleteBackup(serverId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (backupId: string) => deleteBackup(serverId, backupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serverKeys.backups(serverId) })
    },
  })
}

export function useUpdateBackupConfig(serverId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (config: { enabled?: boolean; intervalMinutes?: number; maxBackups?: number; includeLogs?: boolean }) =>
      updateBackupConfig(serverId, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serverKeys.backups(serverId) })
    },
  })
}
