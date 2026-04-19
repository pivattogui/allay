import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createBackup, deleteBackup, fetchBackups, restoreBackup, updateBackupConfig } from '../lib/api'
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
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: serverKeys.backups(serverId) })
      const previous = queryClient.getQueryData(serverKeys.backups(serverId))

      queryClient.setQueryData(serverKeys.backups(serverId), (old: any) => {
        if (!old) return old
        const optimistic = {
          id: `pending-${Date.now()}`,
          filename: 'Creating backup...',
          sizeBytes: 0,
          type: 'manual' as const,
          status: 'pending' as const,
          createdAt: new Date().toISOString(),
        }
        return { ...old, backups: [optimistic, ...(old.backups || [])] }
      })

      return { previous }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: serverKeys.backups(serverId) })
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(serverKeys.backups(serverId), context.previous)
      }
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
