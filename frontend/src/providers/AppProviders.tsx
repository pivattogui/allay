import { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../lib/queryClient'

interface AppProvidersProps {
  children: ReactNode
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}
