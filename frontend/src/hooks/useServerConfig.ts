import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface ServerConfig {
  id: string
  name: string
  type: 'vanilla' | 'paper'
  version: string
  port: number
  ramMinMb: number
  ramMaxMb: number
  jvmArgs: string | null
  javaPath: string | null
  autoStart: boolean
  autoRestart: boolean
  restartLimit: number
  restartSchedule: string | null
  iconPath: string | null
}

export interface UpdateServerConfigInput {
  name?: string
  ramMinMb?: number
  ramMaxMb?: number
  jvmArgs?: string | null
  javaPath?: string | null
  autoStart?: boolean
  autoRestart?: boolean
  restartLimit?: number
  restartSchedule?: string | null
}

export function useServerConfig(serverId: string) {
  return useQuery({
    queryKey: ['serverConfig', serverId],
    queryFn: async () => {
      const response = await api.get<{ config: ServerConfig }>(`/servers/${serverId}/config`)
      return response.data.config
    },
    enabled: !!serverId,
  })
}

export function useUpdateServerConfig(serverId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: UpdateServerConfigInput) => {
      const response = await api.patch(`/servers/${serverId}/config`, data)
      return response.data as { config: ServerConfig; needsRestart: boolean }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serverConfig', serverId] })
      queryClient.invalidateQueries({ queryKey: ['servers'] })
    },
  })
}

export function useUploadServerIcon(serverId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      // Don't set Content-Type manually - browser sets it with boundary automatically for FormData
      const response = await api.post(`/servers/${serverId}/icon`, formData)
      return response.data as { iconPath: string }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serverConfig', serverId] })
      queryClient.invalidateQueries({ queryKey: ['servers'] })
    },
  })
}

export function useDeleteServerIcon(serverId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      await api.delete(`/servers/${serverId}/icon`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['serverConfig', serverId] })
      queryClient.invalidateQueries({ queryKey: ['servers'] })
    },
  })
}
