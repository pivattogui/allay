import {
  AlertTriangle,
  Archive,
  Check,
  Download,
  File,
  FileCode,
  FileJson,
  FileText,
  Folder,
  Image,
  MoreVertical,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { FileEntry } from './FileBrowser'

interface FileTreeProps {
  entries: FileEntry[]
  currentPath: string
  selectedPath: string | null
  onSelect: (entry: FileEntry) => void
  onDelete: (entry: FileEntry) => void
  onRename: (entry: FileEntry, newName: string) => void
  onDownload: (entry: FileEntry) => void
  newFolderName: string | null
  onNewFolderNameChange: (name: string | null) => void
  onNewFolderSubmit: () => void
}

function getFileIcon(entry: FileEntry) {
  if (entry.type === 'directory') {
    return <Folder className="h-4 w-4 text-blue-400" />
  }

  switch (entry.fileType) {
    case 'config':
      if (entry.extension === '.json') {
        return <FileJson className="h-4 w-4 text-yellow-400" />
      }
      return <FileCode className="h-4 w-4 text-green-400" />
    case 'text':
      return <FileText className="h-4 w-4 text-gray-400" />
    case 'image':
      return <Image className="h-4 w-4 text-purple-400" />
    case 'archive':
      return <Archive className="h-4 w-4 text-orange-400" />
    default:
      return <File className="h-4 w-4 text-gray-500" />
  }
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '-'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  if (i < 0 || i >= sizes.length) return '0 B'
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } else if (diffDays === 1) {
    return 'Yesterday'
  } else if (diffDays < 7) {
    return `${diffDays} days ago`
  } else {
    return date.toLocaleDateString()
  }
}

export function FileTree({
  entries,
  currentPath,
  selectedPath,
  onSelect,
  onDelete,
  onRename,
  onDownload,
  newFolderName,
  onNewFolderNameChange,
  onNewFolderSubmit,
}: FileTreeProps) {
  const [renamingEntry, setRenamingEntry] = useState<FileEntry | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const handleStartRename = (entry: FileEntry) => {
    setRenamingEntry(entry)
    setRenameValue(entry.name)
  }

  const handleCancelRename = () => {
    setRenamingEntry(null)
    setRenameValue('')
  }

  const handleSubmitRename = () => {
    if (renamingEntry && renameValue.trim()) {
      onRename(renamingEntry, renameValue.trim())
    }
    handleCancelRename()
  }

  const handleKeyDown = (e: React.KeyboardEvent, submit: () => void, cancel: () => void) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  }

  return (
    <div className="divide-y divide-border">
      {/* New folder input */}
      {newFolderName !== null && (
        <div className="flex items-center gap-2 px-4 py-2 bg-muted/50">
          <Folder className="h-4 w-4 text-blue-400" />
          <Input
            value={newFolderName}
            onChange={(e) => onNewFolderNameChange(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, onNewFolderSubmit, () => onNewFolderNameChange(null))}
            placeholder="Folder name..."
            className="h-7 flex-1"
            autoFocus
          />
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onNewFolderSubmit}>
            <Check className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onNewFolderNameChange(null)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {entries.map((entry) => {
        const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name
        const isSelected = selectedPath === entryPath
        const isRenaming = renamingEntry?.name === entry.name

        return (
          <div
            key={entry.name}
            className={cn(
              'flex items-center gap-3 px-4 py-2 hover:bg-muted/50 cursor-pointer group',
              isSelected && 'bg-muted',
            )}
            onClick={() => !isRenaming && onSelect(entry)}
            onDoubleClick={() => !isRenaming && entry.type === 'directory' && onSelect(entry)}
          >
            {/* Icon */}
            <div className="flex-shrink-0">{getFileIcon(entry)}</div>

            {/* Name */}
            <div className="flex-1 min-w-0">
              {isRenaming ? (
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, handleSubmitRename, handleCancelRename)}
                    className="h-7"
                    autoFocus
                  />
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleSubmitRename}>
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleCancelRename}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm">{entry.name}</span>
                  {entry.sensitive && <AlertTriangle className="h-3 w-3 text-yellow-500 flex-shrink-0" />}
                </div>
              )}
            </div>

            {/* Size */}
            <div className="flex-shrink-0 w-20 text-right text-xs text-muted-foreground">
              {entry.type === 'file' ? formatSize(entry.size) : ''}
            </div>

            {/* Modified */}
            <div className="flex-shrink-0 w-24 text-right text-xs text-muted-foreground hidden md:block">
              {formatDate(entry.modified)}
            </div>

            {/* Actions */}
            <div
              className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {entry.type === 'file' && (
                    <DropdownMenuItem onClick={() => onDownload(entry)}>
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => handleStartRename(entry)}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(entry)}>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )
      })}
    </div>
  )
}
