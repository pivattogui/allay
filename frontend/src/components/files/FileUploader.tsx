import { AlertCircle, CheckCircle2, FileIcon, Loader2, Upload, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getAuthHeaders } from '@/lib/api'
import { backendUrl } from '@/lib/backend'
import { cn } from '@/lib/utils'

const ARCHIVE_EXTENSIONS = ['.zip', '.tar.gz', '.tgz']

function isArchiveFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return ARCHIVE_EXTENSIONS.some((ext) => name.endsWith(ext))
}

interface FileUploaderProps {
  serverId: string
  currentPath: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onUploadComplete: () => void
  onArchiveDetected?: (file: File) => void
}

interface UploadFile {
  file: File
  status: 'pending' | 'uploading' | 'success' | 'error'
  progress?: number
  error?: string
}

function encodedFilePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  if (i < 0 || i >= sizes.length) return '0 B'
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

export function FileUploader({
  serverId,
  currentPath,
  open,
  onOpenChange,
  onUploadComplete,
  onArchiveDetected,
}: FileUploaderProps) {
  const [files, setFiles] = useState<UploadFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)

  const addFiles = useCallback(
    (newFiles: File[]) => {
      // If a single archive file is dropped, redirect to import flow
      if (newFiles.length === 1 && isArchiveFile(newFiles[0]) && onArchiveDetected) {
        onArchiveDetected(newFiles[0])
        return
      }

      const uploadFiles: UploadFile[] = newFiles.map((file) => ({
        file,
        status: 'pending' as const,
      }))
      setFiles((prev) => [...prev, ...uploadFiles])
    },
    [onArchiveDetected],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      const droppedFiles = Array.from(e.dataTransfer.files)
      addFiles(droppedFiles)
    },
    [addFiles],
  )

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        const selectedFiles = Array.from(e.target.files)
        addFiles(selectedFiles)
        e.target.value = ''
      }
    },
    [addFiles],
  )

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const clearFiles = () => {
    setFiles([])
  }

  const handleUpload = async () => {
    if (files.length === 0) return

    setIsUploading(true)
    let uploadedCount = 0

    for (const [index, { file }] of files.entries()) {
      setFiles((prev) =>
        prev.map((item, itemIndex) =>
          itemIndex === index ? { ...item, status: 'uploading', progress: 0, error: undefined } : item,
        ),
      )

      try {
        await uploadFile(file, index)
        uploadedCount += 1
        setFiles((prev) =>
          prev.map((item, itemIndex) => (itemIndex === index ? { ...item, status: 'success', progress: 100 } : item)),
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Upload failed'
        setFiles((prev) =>
          prev.map((item, itemIndex) => (itemIndex === index ? { ...item, status: 'error', error: message } : item)),
        )
      }
    }

    setIsUploading(false)
    if (uploadedCount > 0) onUploadComplete()

    if (uploadedCount === files.length) {
      toast.success(`Uploaded ${uploadedCount} file(s)`)
      setTimeout(() => {
        onOpenChange(false)
        clearFiles()
      }, 1000)
    } else {
      toast.error(`Failed to upload ${files.length - uploadedCount} file(s)`)
    }
  }

  const uploadFile = (file: File, index: number): Promise<void> =>
    new Promise((resolve, reject) => {
      const target = encodedFilePath([currentPath, file.name].filter(Boolean).join('/'))
      const xhr = new XMLHttpRequest()

      xhr.upload.addEventListener('progress', (event) => {
        if (!event.lengthComputable) return
        const progress = Math.round((event.loaded / event.total) * 100)
        setFiles((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, progress } : item)))
      })
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve()
          return
        }

        try {
          const response = JSON.parse(xhr.responseText) as { error?: string }
          reject(new Error(response.error || 'Upload failed'))
        } catch {
          reject(new Error('Upload failed'))
        }
      })
      xhr.addEventListener('error', () => reject(new Error('Network error')))
      xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')))

      xhr.open('PUT', backendUrl(`/api/servers/${serverId}/files/upload/${target}`))
      new Headers(getAuthHeaders()).forEach((value, key) => {
        xhr.setRequestHeader(key, value)
      })
      xhr.setRequestHeader('Content-Type', 'application/octet-stream')
      xhr.send(file)
    })

  const handleClose = () => {
    if (!isUploading) {
      onOpenChange(false)
      clearFiles()
    }
  }

  const pendingCount = files.filter((f) => f.status === 'pending').length
  const totalSize = files.reduce((acc, f) => acc + f.file.size, 0)

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Files</DialogTitle>
        </DialogHeader>

        {/* Drop zone */}
        <div
          className={cn(
            'border-2 border-dashed rounded-lg p-8 text-center transition-colors',
            isDragging ? 'border-primary bg-primary/10' : 'border-muted-foreground/25 hover:border-muted-foreground/50',
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground mb-2">Drag and drop files here, or</p>
          <label>
            <input type="file" multiple onChange={handleFileSelect} className="hidden" disabled={isUploading} />
            <Button variant="secondary" size="sm" asChild disabled={isUploading}>
              <span className="cursor-pointer">Browse Files</span>
            </Button>
          </label>
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="space-y-2 max-h-48 overflow-auto">
            {files.map((item, index) => (
              <div key={index} className="flex items-center gap-3 p-2 rounded bg-muted/50">
                <FileIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{item.file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatSize(item.file.size)}</p>
                </div>
                {item.status === 'pending' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => removeFile(index)}
                    disabled={isUploading}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
                {item.status === 'uploading' && (
                  <span className="text-xs text-primary tabular-nums">{item.progress ?? 0}%</span>
                )}
                {item.status === 'success' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                {item.status === 'error' && <AlertCircle className="h-4 w-4 text-destructive" />}
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        {files.length > 0 && (
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <p className="text-sm text-muted-foreground">
              {pendingCount} file(s) · {formatSize(totalSize)}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={clearFiles} disabled={isUploading}>
                Clear
              </Button>
              <Button size="sm" onClick={handleUpload} disabled={isUploading || pendingCount === 0}>
                {isUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Target path info */}
        <p className="text-xs text-muted-foreground">
          Uploading to: <code className="bg-muted px-1 rounded">/{currentPath || 'root'}</code>
        </p>
      </DialogContent>
    </Dialog>
  )
}
