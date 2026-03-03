import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 4000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
