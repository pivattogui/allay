import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchProperties, updateProperties } from '../lib/api'
import { serverKeys } from '../lib/queryKeys'

export function useServerProperties(serverId: string) {
  return useQuery({
    queryKey: serverKeys.properties(serverId),
    queryFn: () => fetchProperties(serverId),
    enabled: !!serverId,
  })
}

export function useUpdateServerProperties(serverId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (properties: Record<string, string>) => updateProperties(serverId, properties),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serverKeys.properties(serverId) })
    },
  })
}
