import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface JavaVersion {
  version: string
  path: string
  vendor: string | null
}

export function useJavaVersions() {
  return useQuery({
    queryKey: ['javaVersions'],
    queryFn: async () => {
      const response = await api.get<{ versions: JavaVersion[] }>('/system/java-versions')
      return response.data.versions
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

export function useRefreshJavaVersions() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const response = await api.post<{ versions: JavaVersion[] }>('/system/java-versions/refresh')
      return response.data.versions
    },
    onSuccess: (versions) => {
      queryClient.setQueryData(['javaVersions'], versions)
    },
  })
}
