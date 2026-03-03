import { useQuery } from '@tanstack/react-query'
import { fetchServers } from '../lib/api'
import { serverKeys } from '../lib/queryKeys'

export function useServers() {
  return useQuery({
    queryKey: serverKeys.all,
    queryFn: fetchServers,
    refetchInterval: 5000,
    staleTime: 4000,
  })
}
