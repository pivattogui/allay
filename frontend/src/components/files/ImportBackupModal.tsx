import { useCallback, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { useBackupImport } from '@/hooks/useBackupImport'
import { Upload, FileArchive, Check, AlertCircle, Loader2, FolderTree, Settings, Puzzle, FileQuestion } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DiffItem, DiffSelection } from '@/lib/api'

interface ImportBackupModalProps {
  serverId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

type DiffCategory = 'world' | 'config' | 'plugins' | 'other'

const categoryInfo: Record<DiffCategory, { label: string; icon: typeof FolderTree; color: string }> = {
  world: { label: 'World Data', icon: FolderTree, color: 'text-green-500' },
  config: { label: 'Configurations', icon: Settings, color: 'text-blue-500' },
  plugins: { label: 'Plugins', icon: Puzzle, color: 'text-purple-500' },
  other: { label: 'Other Files', icon: FileQuestion, color: 'text-gray-500' },
}

export function ImportBackupModal({ serverId, open, onOpenChange, onSuccess }: ImportBackupModalProps) {
  const { state, reset, upload, applyChanges, isGeneratingDiff, isApplying } = useBackupImport(serverId)
  const [selectedCategories, setSelectedCategories] = useState<Set<DiffCategory>>(new Set(['world', 'config']))
  const [dragActive, setDragActive] = useState(false)

  const handleClose = useCallback(() => {
    reset()
    setSelectedCategories(new Set(['world', 'config']))
    onOpenChange(false)
  }, [reset, onOpenChange])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files[0]
    if (file && (file.name.endsWith('.tar.gz') || file.name.endsWith('.tgz') || file.name.endsWith('.zip'))) {
      upload.mutate(file)
    }
  }, [upload])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      upload.mutate(file)
    }
  }, [upload])

  const toggleCategory = useCallback((category: DiffCategory) => {
    setSelectedCategories(prev => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }, [])

  const groupedDiffs = useMemo(() => {
    if (!state.diffResult) return null

    const groups: Record<DiffCategory, DiffItem[]> = {
      world: [],
      config: [],
      plugins: [],
      other: [],
    }

    for (const item of state.diffResult.items) {
      groups[item.category as DiffCategory].push(item)
    }

    return groups
  }, [state.diffResult])

  const handleApply = useCallback(() => {
    if (!state.diffResult) return

    const selections: DiffSelection[] = state.diffResult.items.map(item => ({
      id: item.id,
      action: selectedCategories.has(item.category as DiffCategory) ? 'use-backup' : 'keep',
    }))

    applyChanges.mutate(selections)
  }, [state.diffResult, selectedCategories, applyChanges])

  const handleComplete = useCallback(() => {
    onSuccess()
    handleClose()
  }, [onSuccess, handleClose])

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Backup</DialogTitle>
          <DialogDescription>
            {state.step === 'idle' && 'Upload a backup file to import into this server'}
            {state.step === 'uploading' && 'Uploading and analyzing backup...'}
            {state.step === 'reviewing' && 'Select which categories to import'}
            {state.step === 'applying' && 'Applying changes...'}
            {state.step === 'complete' && 'Import completed successfully'}
            {state.step === 'error' && 'An error occurred'}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {/* Upload Step */}
          {state.step === 'idle' && (
            <div
              className={cn(
                'border-2 border-dashed rounded-lg p-8 text-center transition-colors',
                dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
              )}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
            >
              <FileArchive className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground mb-2">
                Drag & drop a backup file here
              </p>
              <p className="text-xs text-muted-foreground mb-4">
                Supports .tar.gz and .zip files
              </p>
              <label>
                <input
                  type="file"
                  className="hidden"
                  accept=".tar.gz,.tgz,.zip"
                  onChange={handleFileSelect}
                />
                <Button variant="outline" size="sm" asChild>
                  <span>
                    <Upload className="h-4 w-4 mr-2" />
                    Browse Files
                  </span>
                </Button>
              </label>
            </div>
          )}

          {/* Uploading Step */}
          {state.step === 'uploading' && (
            <div className="space-y-4">
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
              <Progress value={state.uploadProgress} className="h-2" />
              <p className="text-sm text-center text-muted-foreground">
                {isGeneratingDiff ? 'Analyzing backup...' : `Uploading... ${state.uploadProgress}%`}
              </p>
            </div>
          )}

          {/* Review Step */}
          {state.step === 'reviewing' && groupedDiffs && (
            <div className="space-y-4">
              {state.metadata && (
                <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
                  <p><strong>Format:</strong> {state.metadata.serverType}</p>
                  {state.metadata.minecraftVersion && (
                    <p><strong>Version:</strong> {state.metadata.minecraftVersion}</p>
                  )}
                </div>
              )}

              <div className="space-y-3">
                {(Object.keys(groupedDiffs) as DiffCategory[]).map(category => {
                  const items = groupedDiffs[category]
                  if (items.length === 0) return null

                  const info = categoryInfo[category]
                  const Icon = info.icon
                  const totalSize = items.reduce((acc, item) => acc + (item.backupSize || 0), 0)
                  const isSelected = selectedCategories.has(category)

                  return (
                    <div
                      key={category}
                      className={cn(
                        'border rounded-lg p-3 cursor-pointer transition-colors',
                        isSelected ? 'border-primary bg-primary/5' : 'border-border'
                      )}
                      onClick={() => toggleCategory(category)}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleCategory(category)}
                        />
                        <Icon className={cn('h-5 w-5', info.color)} />
                        <div className="flex-1">
                          <p className="font-medium text-sm">{info.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {items.length} {items.length === 1 ? 'item' : 'items'} ({formatSize(totalSize)})
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {state.error && (
                <div className="flex items-center gap-2 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4" />
                  <span>{state.error}</span>
                </div>
              )}
            </div>
          )}

          {/* Applying Step */}
          {state.step === 'applying' && (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
              <p className="text-sm text-muted-foreground">Applying changes...</p>
            </div>
          )}

          {/* Complete Step */}
          {state.step === 'complete' && (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center mb-4">
                <Check className="h-6 w-6 text-green-500" />
              </div>
              <p className="text-sm font-medium">Import Successful</p>
              <p className="text-xs text-muted-foreground mt-1">
                The backup has been imported to your server
              </p>
            </div>
          )}

          {/* Error Step */}
          {state.step === 'error' && (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
                <AlertCircle className="h-6 w-6 text-destructive" />
              </div>
              <p className="text-sm font-medium">Import Failed</p>
              <p className="text-xs text-muted-foreground mt-1 text-center">
                {state.error || 'An unknown error occurred'}
              </p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex justify-end gap-2">
          {state.step === 'idle' && (
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
          )}

          {state.step === 'reviewing' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleApply}
                disabled={selectedCategories.size === 0 || isApplying}
              >
                {isApplying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Import Selected
              </Button>
            </>
          )}

          {state.step === 'complete' && (
            <Button onClick={handleComplete}>
              Done
            </Button>
          )}

          {state.step === 'error' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={reset}>
                Try Again
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
