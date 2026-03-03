import { useState, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  uploadBackupForImport,
  generateImportDiff,
  applyImportChanges,
  cancelImport,
  type BackupMetadata,
  type DiffResult,
  type DiffSelection,
} from '../lib/api'

export type ImportStep = 'idle' | 'uploading' | 'reviewing' | 'applying' | 'complete' | 'error'

export interface BackupImportState {
  step: ImportStep
  tempFileId: string | null
  metadata: BackupMetadata | null
  diffResult: DiffResult | null
  uploadProgress: number
  error: string | null
}

const initialState: BackupImportState = {
  step: 'idle',
  tempFileId: null,
  metadata: null,
  diffResult: null,
  uploadProgress: 0,
  error: null,
}

export function useBackupImport(serverId: string) {
  const [state, setState] = useState<BackupImportState>(initialState)

  const reset = useCallback(() => {
    // Clean up temp file if exists
    if (state.tempFileId) {
      cancelImport(serverId, state.tempFileId).catch(() => {})
    }
    setState(initialState)
  }, [serverId, state.tempFileId])

  const setError = useCallback((error: string | null) => {
    setState(prev => ({ ...prev, error, step: error ? 'error' : prev.step }))
  }, [])

  const upload = useMutation({
    mutationFn: async (file: File) => {
      setState(prev => ({ ...prev, step: 'uploading', uploadProgress: 0, error: null }))
      return uploadBackupForImport(serverId, file, (percent) => {
        setState(prev => ({ ...prev, uploadProgress: percent }))
      })
    },
    onSuccess: async (data) => {
      setState(prev => ({
        ...prev,
        tempFileId: data.tempFileId,
        metadata: data.metadata,
        uploadProgress: 100,
      }))
      // Automatically generate diff after upload
      generateDiffMutation.mutate(data.tempFileId)
    },
    onError: (error: Error) => {
      setState(prev => ({ ...prev, error: error.message, step: 'error', uploadProgress: 0 }))
    },
  })

  const generateDiffMutation = useMutation({
    mutationFn: async (tempFileId: string) => {
      return generateImportDiff(serverId, tempFileId)
    },
    onSuccess: (data) => {
      setState(prev => ({ ...prev, step: 'reviewing', diffResult: data, error: null }))
    },
    onError: (error: Error) => {
      setState(prev => ({ ...prev, error: error.message, step: 'error' }))
    },
  })

  const applyChanges = useMutation({
    mutationFn: async (selections: DiffSelection[]) => {
      if (!state.tempFileId) {
        throw new Error('No file uploaded')
      }
      setState(prev => ({ ...prev, step: 'applying' }))
      return applyImportChanges(serverId, state.tempFileId, selections)
    },
    onSuccess: () => {
      setState(prev => ({ ...prev, step: 'complete', error: null }))
    },
    onError: (error: Error) => {
      setState(prev => ({ ...prev, step: 'reviewing', error: error.message }))
    },
  })

  return {
    state,
    reset,
    setError,
    upload,
    applyChanges,
    isUploading: upload.isPending,
    isGeneratingDiff: generateDiffMutation.isPending,
    isApplying: applyChanges.isPending,
  }
}

export type UseBackupImportReturn = ReturnType<typeof useBackupImport>
