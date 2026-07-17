import { FolderOpen, FolderPlus, RefreshCw, Upload } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ImportDialog } from '@/components/backups/ImportDialog'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { getAuthHeaders } from '@/lib/api'
import { backendFetch as fetch } from '@/lib/backend'
import { FileBreadcrumb } from './FileBreadcrumb'
import { FileEditor } from './FileEditor'
import { FileTree } from './FileTree'
import { FileUploader } from './FileUploader'

export interface FileEntry {
  name: string
  type: 'file' | 'directory'
  size: number
  modified: string
  extension?: string
  editable?: boolean
  sensitive?: boolean
  fileType?: 'text' | 'config' | 'image' | 'archive' | 'binary'
}

interface FileBrowserProps {
  serverId: string
  serverName: string
}

export function FileBrowser({ serverId }: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState<{ path: string; entry: FileEntry } | null>(null)
  const [editorContent, setEditorContent] = useState<string | null>(null)
  const [editorLoading, setEditorLoading] = useState(false)
  const [isModified, setIsModified] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [newFolderName, setNewFolderName] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null)
  const [discardCallback, setDiscardCallback] = useState<(() => void) | null>(null)

  const fetchEntries = useCallback(
    async (path: string = '') => {
      setLoading(true)
      try {
        const res = await fetch(`/api/servers/${serverId}/files/list`, {
          method: 'POST',
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ path }),
        })

        if (res.ok) {
          const data = await res.json()
          setEntries(data.entries || [])
          setCurrentPath(data.path === '/' ? '' : data.path)
        } else {
          const err = await res.json()
          toast.error(err.error || 'Failed to load files')
        }
      } catch (_err) {
        toast.error('Failed to load files')
      } finally {
        setLoading(false)
      }
    },
    [serverId],
  )

  useEffect(() => {
    fetchEntries(currentPath)
  }, [fetchEntries, currentPath])

  const discardAndDo = (action: () => void) => {
    if (isModified) {
      setDiscardCallback(() => action)
      return
    }
    action()
  }

  const handleNavigate = (path: string) => {
    discardAndDo(() => {
      setSelectedFile(null)
      setEditorContent(null)
      setIsModified(false)
      fetchEntries(path)
    })
  }

  const openFile = async (entry: FileEntry) => {
    const filePath = currentPath ? `${currentPath}/${entry.name}` : entry.name
    setSelectedFile({ path: filePath, entry })
    setEditorLoading(true)
    setIsModified(false)

    try {
      const res = await fetch(`/api/servers/${serverId}/files/read/${filePath}`, {
        headers: getAuthHeaders(),
      })

      if (res.ok) {
        const data = await res.json()
        if (data.tooLarge) {
          toast.error('File is too large to edit (max 1MB)')
          setSelectedFile(null)
          setEditorContent(null)
        } else if (data.content === null) {
          toast.info(data.message || 'Cannot edit this file')
          setSelectedFile(null)
          setEditorContent(null)
        } else {
          setEditorContent(data.content)
        }
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to read file')
        setSelectedFile(null)
      }
    } catch (_err) {
      toast.error('Failed to read file')
      setSelectedFile(null)
    } finally {
      setEditorLoading(false)
    }
  }

  const handleSelect = (entry: FileEntry) => {
    if (entry.type === 'directory') {
      const newPath = currentPath ? `${currentPath}/${entry.name}` : entry.name
      handleNavigate(newPath)
      return
    }

    if (!entry.editable) {
      toast.info('This file type cannot be edited. Use download instead.')
      return
    }

    discardAndDo(() => openFile(entry))
  }

  const handleSave = async () => {
    if (!selectedFile || editorContent === null) return

    setIsSaving(true)
    try {
      const res = await fetch(`/api/servers/${serverId}/files/write/${selectedFile.path}`, {
        method: 'PUT',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: editorContent }),
      })

      if (res.ok) {
        toast.success('File saved')
        setIsModified(false)
        fetchEntries(currentPath)
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to save file')
      }
    } catch (_err) {
      toast.error('Failed to save file')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCloseEditor = () => {
    discardAndDo(() => {
      setSelectedFile(null)
      setEditorContent(null)
      setIsModified(false)
    })
  }

  const handleDeleteRequest = (entry: FileEntry) => {
    setDeleteTarget(entry)
  }

  const executeDelete = async (entry: FileEntry) => {
    const itemPath = currentPath ? `${currentPath}/${entry.name}` : entry.name

    try {
      const res = await fetch(`/api/servers/${serverId}/files/${itemPath}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      })

      if (res.ok) {
        toast.success(`${entry.type === 'directory' ? 'Folder' : 'File'} deleted`)
        if (selectedFile?.path === itemPath) {
          setSelectedFile(null)
          setEditorContent(null)
        }
        fetchEntries(currentPath)
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to delete')
      }
    } catch (_err) {
      toast.error('Failed to delete')
    }
  }

  const handleRename = async (entry: FileEntry, newName: string) => {
    if (newName === entry.name || !newName.trim()) return

    const oldPath = currentPath ? `${currentPath}/${entry.name}` : entry.name
    const newPath = currentPath ? `${currentPath}/${newName}` : newName

    try {
      const res = await fetch(`/api/servers/${serverId}/files/rename`, {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ oldPath, newPath }),
      })

      if (res.ok) {
        toast.success('Renamed successfully')
        if (selectedFile?.path === oldPath) {
          setSelectedFile({ ...selectedFile, path: newPath })
        }
        fetchEntries(currentPath)
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to rename')
      }
    } catch (_err) {
      toast.error('Failed to rename')
    }
  }

  const handleDownload = async (entry: FileEntry) => {
    const filePath = currentPath ? `${currentPath}/${entry.name}` : entry.name

    try {
      const res = await fetch(`/api/servers/${serverId}/files/download/${filePath}`, {
        headers: getAuthHeaders(),
      })

      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = entry.name
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to download')
      }
    } catch (_err) {
      toast.error('Failed to download')
    }
  }

  const handleCreateFolder = async () => {
    if (!newFolderName?.trim()) {
      setNewFolderName(null)
      return
    }

    const folderPath = currentPath ? `${currentPath}/${newFolderName}` : newFolderName

    try {
      const res = await fetch(`/api/servers/${serverId}/files/mkdir/${folderPath}`, {
        method: 'POST',
        headers: getAuthHeaders(),
      })

      if (res.ok) {
        toast.success('Folder created')
        setNewFolderName(null)
        fetchEntries(currentPath)
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to create folder')
      }
    } catch (_err) {
      toast.error('Failed to create folder')
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex-shrink-0 px-6 py-3 border-b border-border flex items-center justify-between gap-4">
        <FileBreadcrumb path={currentPath} onNavigate={handleNavigate} />

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchEntries(currentPath)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => setNewFolderName('')} disabled={newFolderName !== null}>
            <FolderPlus className="h-4 w-4 mr-2" />
            New Folder
          </Button>
          <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Upload
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* File Tree */}
        <div className="w-1/2 border-r border-border overflow-auto">
          {loading ? (
            <div className="p-4 space-y-2">
              {[...Array(8)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="Empty directory"
              description="This folder has no files or subfolders"
            />
          ) : (
            <FileTree
              entries={entries}
              currentPath={currentPath}
              selectedPath={selectedFile?.path || null}
              onSelect={handleSelect}
              onDelete={handleDeleteRequest}
              onRename={handleRename}
              onDownload={handleDownload}
              newFolderName={newFolderName}
              onNewFolderNameChange={setNewFolderName}
              onNewFolderSubmit={handleCreateFolder}
            />
          )}
        </div>

        {/* Editor Panel */}
        <div className="w-1/2 overflow-hidden">
          {editorLoading ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-[calc(100vh-300px)] w-full" />
            </div>
          ) : selectedFile && editorContent !== null ? (
            <FileEditor
              filePath={selectedFile.path}
              fileName={selectedFile.entry.name}
              content={editorContent}
              sensitive={selectedFile.entry.sensitive}
              onChange={(content) => {
                setEditorContent(content)
                setIsModified(true)
              }}
              onSave={handleSave}
              onClose={handleCloseEditor}
              isModified={isModified}
              isSaving={isSaving}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <FolderOpen className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Select a file to edit</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Upload Dialog */}
      <FileUploader
        serverId={serverId}
        currentPath={currentPath}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploadComplete={() => fetchEntries(currentPath)}
        onArchiveDetected={(file) => {
          setUploadOpen(false)
          setImportFile(file)
          setImportOpen(true)
        }}
      />

      {/* Import Dialog (triggered by archive detection) */}
      <ImportDialog
        serverId={serverId}
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open)
          if (!open) setImportFile(null)
        }}
        initialFile={importFile}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={`Delete ${deleteTarget?.type === 'directory' ? 'Folder' : 'File'}`}
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (deleteTarget) executeDelete(deleteTarget)
          setDeleteTarget(null)
        }}
      />

      {/* Unsaved Changes Confirmation */}
      <ConfirmDialog
        open={!!discardCallback}
        onOpenChange={(open) => {
          if (!open) setDiscardCallback(null)
        }}
        title="Unsaved Changes"
        description="You have unsaved changes. Discard them?"
        confirmLabel="Discard"
        variant="destructive"
        onConfirm={() => {
          if (discardCallback) {
            setIsModified(false)
            discardCallback()
          }
          setDiscardCallback(null)
        }}
      />
    </div>
  )
}
