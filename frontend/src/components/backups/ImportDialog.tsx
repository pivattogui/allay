import { FileArchive, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { useAnalyzeImport, useExecuteImport } from '@/hooks/useImport'
import type { ImportAnalysis, ImportSelection } from '@/lib/api'
import { ImportDropZone } from './ImportDropZone'
import { ImportManualSelection } from './ImportManualSelection'
import { ImportSuggestion } from './ImportSuggestion'

interface ImportDialogProps {
  serverId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  initialFile?: File | null
}

type FlowState = 'upload' | 'analyzing' | 'review' | 'manual' | 'importing'

export function ImportDialog({ serverId, open, onOpenChange, initialFile }: ImportDialogProps) {
  const [state, setState] = useState<FlowState>('upload')
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [uploadFileName, setUploadFileName] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null)

  const analyzeMutation = useAnalyzeImport(serverId)
  const executeMutation = useExecuteImport(serverId)

  const reset = useCallback(() => {
    setState('upload')
    setUploadProgress(null)
    setUploadFileName(null)
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
      setUploadFileName(file.name)
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

  // Auto-trigger analysis when opened with a pre-selected file
  const processedFileRef = useRef<File | null>(null)
  useEffect(() => {
    if (open && initialFile && initialFile !== processedFileRef.current) {
      processedFileRef.current = initialFile
      handleFileSelected(initialFile)
    }
    if (!open) {
      processedFileRef.current = null
    }
  }, [open, initialFile, handleFileSelected])

  const handleExecute = useCallback(
    async (selection: ImportSelection) => {
      if (!analysis) return
      setState('importing')
      try {
        await executeMutation.mutateAsync({
          importId: analysis.importId,
          selection,
        })
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

        {state === 'upload' && <ImportDropZone onFileSelected={handleFileSelected} uploadProgress={null} />}

        {state === 'analyzing' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-lg border p-4">
              <FileArchive className="h-5 w-5 text-muted-foreground shrink-0" />
              <p className="text-sm font-medium truncate">{uploadFileName}</p>
            </div>
            <Progress value={uploadProgress ?? 0} className="h-2" />
            <p className="text-xs text-muted-foreground text-center">
              {(uploadProgress ?? 0) < 100 ? `Uploading... ${uploadProgress ?? 0}%` : 'Analyzing contents...'}
            </p>
          </div>
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
