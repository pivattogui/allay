import { useQuery } from '@tanstack/react-query'
import { fetchServer } from '../lib/api'
import { serverKeys } from '../lib/queryKeys'

export function useServer(id: string) {
  return useQuery({
    queryKey: serverKeys.detail(id),
    queryFn: () => fetchServer(id),
    enabled: !!id,
  })
}
