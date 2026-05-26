import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ImportSelection } from '../lib/api'
import { analyzeImport, executeImport } from '../lib/api'
import { serverKeys } from '../lib/queryKeys'

export function useAnalyzeImport(serverId: string) {
  return useMutation({
    mutationFn: ({ file, onProgress }: { file: File; onProgress?: (percent: number) => void }) =>
      analyzeImport(serverId, file, onProgress),
  })
}

export function useExecuteImport(serverId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ importId, selection }: { importId: string; selection: ImportSelection }) =>
      executeImport(serverId, importId, selection),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serverKeys.backups(serverId) })
    },
  })
}
