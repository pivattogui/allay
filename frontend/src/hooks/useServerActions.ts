import { useMutation, useQueryClient } from '@tanstack/react-query'
import { startServer, stopServer, deleteServer, createServer, type CreateServerData } from '../lib/api'
import { serverKeys } from '../lib/queryKeys'
import { useUIStore } from '../stores'

export function useStartServer() {
  const queryClient = useQueryClient()
  const setPendingAction = useUIStore((s) => s.setPendingAction)

  return useMutation({
    mutationFn: (serverId: string) => startServer(serverId),
    onMutate: (serverId) => {
      setPendingAction(serverId, 'start')
    },
    onSettled: (_data, _error, serverId) => {
      setPendingAction(serverId, null)
      queryClient.invalidateQueries({ queryKey: serverKeys.all })
      queryClient.invalidateQueries({ queryKey: serverKeys.detail(serverId) })
    },
  })
}

export function useStopServer() {
  const queryClient = useQueryClient()
  const setPendingAction = useUIStore((s) => s.setPendingAction)

  return useMutation({
    mutationFn: (serverId: string) => stopServer(serverId),
    onMutate: (serverId) => {
      setPendingAction(serverId, 'stop')
    },
    onSettled: (_data, _error, serverId) => {
      setPendingAction(serverId, null)
      queryClient.invalidateQueries({ queryKey: serverKeys.all })
      queryClient.invalidateQueries({ queryKey: serverKeys.detail(serverId) })
    },
  })
}

export function useDeleteServer() {
  const queryClient = useQueryClient()
  const setPendingAction = useUIStore((s) => s.setPendingAction)

  return useMutation({
    mutationFn: (serverId: string) => deleteServer(serverId),
    onMutate: (serverId) => {
      setPendingAction(serverId, 'delete')
    },
    onSettled: (_data, _error, serverId) => {
      setPendingAction(serverId, null)
      queryClient.invalidateQueries({ queryKey: serverKeys.all })
      queryClient.invalidateQueries({ queryKey: serverKeys.detail(serverId) })
    },
  })
}

export function useCreateServer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateServerData) => createServer(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serverKeys.all })
    },
  })
}
