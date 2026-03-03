import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useMinecraftVersions(type: 'vanilla' | 'paper') {
  return useQuery({
    queryKey: ['minecraftVersions', type],
    queryFn: async () => {
      const response = await api.get<{ versions: string[] }>(`/system/versions/${type}`)
      return response.data.versions
    },
    staleTime: 60 * 60 * 1000, // 1 hour
  })
}
