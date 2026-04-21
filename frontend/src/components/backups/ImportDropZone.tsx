import { FileArchive, Upload } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Progress } from '@/components/ui/progress'

interface ImportDropZoneProps {
  onFileSelected: (file: File) => void
  uploadProgress: number | null
  disabled?: boolean
}

const ACCEPTED_TYPES = ['.zip', '.tar.gz', '.tgz']

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

function isValidFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return ACCEPTED_TYPES.some((ext) => name.endsWith(ext))
}

export function ImportDropZone({ onFileSelected, uploadProgress, disabled }: ImportDropZoneProps) {
  const [dragOver, setDragOver] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const isUploading = uploadProgress !== null

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      if (disabled || isUploading) return

      const file = e.dataTransfer.files[0]
      if (file && isValidFile(file)) {
        setSelectedFile(file)
        onFileSelected(file)
      }
    },
    [disabled, isUploading, onFileSelected],
  )

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file && isValidFile(file)) {
        setSelectedFile(file)
        onFileSelected(file)
      }
      e.target.value = ''
    },
    [onFileSelected],
  )

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled && !isUploading) setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'} ${disabled || isUploading ? 'pointer-events-none opacity-50' : 'cursor-pointer hover:border-muted-foreground/50'}`}
        onClick={() => {
          if (!disabled && !isUploading) {
            document.getElementById('import-file-input')?.click()
          }
        }}
      >
        <Upload className="h-8 w-8 text-muted-foreground" />
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">Drop archive here or click to browse</p>
          <p className="text-xs text-muted-foreground mt-1">.zip, .tar.gz, .tgz</p>
        </div>
        <input
          id="import-file-input"
          type="file"
          accept=".zip,.tar.gz,.tgz"
          className="hidden"
          onChange={handleFileInput}
          disabled={disabled || isUploading}
        />
      </div>

      {isUploading && selectedFile && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <FileArchive className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium truncate">{selectedFile.name}</span>
            <span className="text-muted-foreground ml-auto">{formatBytes(selectedFile.size)}</span>
          </div>
          <Progress value={uploadProgress} className="h-2" />
          <p className="text-xs text-muted-foreground">
            {uploadProgress < 100 ? `Uploading... ${uploadProgress}%` : 'Analyzing...'}
          </p>
        </div>
      )}
    </div>
  )
}
