import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface MigrationInput {
  type: 'vanilla' | 'paper'
  version: string
}

export interface MigrationResult {
  message: string
  backupId: string
  migration: {
    fromType: string
    fromVersion: string
    toType: string
    toVersion: string
  }
}

export function useVersionMigration(serverId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: MigrationInput) => {
      const response = await api.post(`/servers/${serverId}/migrate`, data)
      return response.data as MigrationResult
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serverConfig', serverId] })
      queryClient.invalidateQueries({ queryKey: ['servers'] })
    },
  })
}
