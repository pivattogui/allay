import { Loader2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ImportAnalysis, ImportSelection } from '@/hooks/useImport'
import { useAnalyzeImport, useExecuteImport } from '@/hooks/useImport'
import { ImportDropZone } from './ImportDropZone'
import { ImportManualSelection } from './ImportManualSelection'
import { ImportSuggestion } from './ImportSuggestion'

interface ImportDialogProps {
  serverId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type FlowState = 'upload' | 'analyzing' | 'review' | 'manual' | 'importing' | 'done'

export function ImportDialog({ serverId, open, onOpenChange }: ImportDialogProps) {
  const [state, setState] = useState<FlowState>('upload')
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null)

  const analyzeMutation = useAnalyzeImport(serverId)
  const executeMutation = useExecuteImport(serverId)

  const reset = useCallback(() => {
    setState('upload')
    setUploadProgress(null)
    setAnalysis(null)
  }, [])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) reset()
      onOpenChange(nextOpen)
    },
    [onOpenChange, reset],
  )

  const handleFileSelected = useCallback(
    async (file: File) => {
      setState('analyzing')
      setUploadProgress(0)
      try {
        const result = await analyzeMutation.mutateAsync({
          file,
          onProgress: setUploadProgress,
        })
        setAnalysis(result)
        setState('review')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Upload failed')
        reset()
      } finally {
        setUploadProgress(null)
      }
    },
    [analyzeMutation, reset],
  )

  const handleExecute = useCallback(
    async (selection: ImportSelection) => {
      if (!analysis) return
      setState('importing')
      try {
        await executeMutation.mutateAsync({
          importId: analysis.importId,
          selection,
        })
        setState('done')
        toast.success('Import completed — pre-import backup created')
        handleOpenChange(false)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Import failed')
        setState('review')
      }
    },
    [analysis, executeMutation, handleOpenChange],
  )

  const handleAcceptPreset = useCallback(() => {
    if (!analysis?.suggestedPreset) return
    handleExecute({ preset: analysis.suggestedPreset, include: [], exclude: [] })
  }, [analysis, handleExecute])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import</DialogTitle>
          <DialogDescription>
            {state === 'upload' && 'Upload a world or server backup archive'}
            {state === 'analyzing' && 'Uploading and analyzing...'}
            {state === 'review' && 'Review detected contents'}
            {state === 'manual' && 'Select what to import'}
            {state === 'importing' && 'Importing...'}
          </DialogDescription>
        </DialogHeader>

        {(state === 'upload' || state === 'analyzing') && (
          <ImportDropZone
            onFileSelected={handleFileSelected}
            uploadProgress={uploadProgress}
            disabled={state === 'analyzing'}
          />
        )}

        {state === 'review' && analysis && (
          <ImportSuggestion
            analysis={analysis}
            onAcceptPreset={handleAcceptPreset}
            onManualSelect={() => setState('manual')}
            loading={executeMutation.isPending}
          />
        )}

        {state === 'manual' && analysis && (
          <ImportManualSelection
            analysis={analysis}
            onConfirm={handleExecute}
            onBack={() => setState('review')}
            loading={executeMutation.isPending}
          />
        )}

        {state === 'importing' && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Creating pre-import backup and extracting files...</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
