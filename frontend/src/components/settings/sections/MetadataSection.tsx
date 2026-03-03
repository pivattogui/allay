import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useUpdateServerConfig, useUploadServerIcon, useDeleteServerIcon, type ServerConfig } from '@/hooks/useServerConfig'
import { useToast } from '@/hooks/use-toast'
import { Loader2, Upload, Trash2, Image } from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores'

interface MetadataSectionProps {
  serverId: string
  config: ServerConfig
}

export function MetadataSection({ serverId, config }: MetadataSectionProps) {
  const [name, setName] = useState(config.name)
  const [iconKey, setIconKey] = useState(Date.now())
  const [iconUrl, setIconUrl] = useState<string | null>(null)
  const { toast } = useToast()
  const token = useAuthStore((state) => state.token)

  // Fetch icon with auth header and create blob URL
  useEffect(() => {
    if (!config.iconPath) {
      setIconUrl(null)
      return
    }

    const fetchIcon = async () => {
      try {
        const response = await fetch(`/api/servers/${serverId}/icon`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (response.ok) {
          const blob = await response.blob()
          const url = URL.createObjectURL(blob)
          setIconUrl(url)
        } else {
          setIconUrl(null)
        }
      } catch {
        setIconUrl(null)
      }
    }

    fetchIcon()

    // Cleanup blob URL on unmount
    return () => {
      if (iconUrl) {
        URL.revokeObjectURL(iconUrl)
      }
    }
  }, [serverId, config.iconPath, iconKey, token])

  const updateConfig = useUpdateServerConfig(serverId)
  const uploadIcon = useUploadServerIcon(serverId)
  const deleteIcon = useDeleteServerIcon(serverId)

  const handleSaveName = async () => {
    if (name === config.name) return

    try {
      await updateConfig.mutateAsync({ name })
      toast({ title: 'Name updated successfully' })
    } catch {
      toast({ title: 'Failed to update name', variant: 'destructive' })
    }
  }

  const handleIconUpload = async (file: File) => {
    try {
      await uploadIcon.mutateAsync(file)
      setIconKey(Date.now()) // Force image refresh
      toast({ title: 'Icon uploaded successfully' })
    } catch {
      toast({ title: 'Failed to upload icon', variant: 'destructive' })
    }
  }

  const handleDeleteIcon = async () => {
    try {
      await deleteIcon.mutateAsync()
      toast({ title: 'Icon removed successfully' })
    } catch {
      toast({ title: 'Failed to remove icon', variant: 'destructive' })
    }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif'] },
    maxSize: 5 * 1024 * 1024,
    multiple: false,
    onDrop: (files) => {
      if (files[0]) handleIconUpload(files[0])
    },
  })

  const isLoading = updateConfig.isPending || uploadIcon.isPending || deleteIcon.isPending

  return (
    <div className="space-y-6 pb-4">
      {/* Server Name */}
      <div className="space-y-2">
        <Label htmlFor="name">Server Name</Label>
        <div className="flex gap-2">
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Server"
            maxLength={50}
          />
          <Button
            onClick={handleSaveName}
            disabled={name === config.name || isLoading}
          >
            {updateConfig.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Display name for the server (1-50 characters)
        </p>
      </div>

      {/* Server Icon */}
      <div className="space-y-2">
        <Label>Server Icon</Label>
        <div className="flex items-start gap-4">
          {/* Icon Preview */}
          <div className="w-16 h-16 border rounded-lg overflow-hidden bg-muted flex items-center justify-center">
            {config.iconPath && iconUrl ? (
              <img
                src={iconUrl}
                alt="Server icon"
                className="w-full h-full object-cover"
              />
            ) : (
              <Image className="h-8 w-8 text-muted-foreground" />
            )}
          </div>

          {/* Upload Zone */}
          <div className="flex-1">
            <div
              {...getRootProps()}
              className={cn(
                'border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors',
                isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'
              )}
            >
              <input {...getInputProps()} />
              {uploadIcon.isPending ? (
                <Loader2 className="h-6 w-6 animate-spin mx-auto" />
              ) : (
                <>
                  <Upload className="h-6 w-6 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground mt-2">
                    {isDragActive ? 'Drop image here' : 'Drag & drop or click to upload'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    PNG, JPG, GIF (max 5MB, will resize to 64x64)
                  </p>
                </>
              )}
            </div>

            {config.iconPath && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 text-destructive"
                onClick={handleDeleteIcon}
                disabled={deleteIcon.isPending}
              >
                {deleteIcon.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Remove Icon
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Server Info (Read-only) */}
      <div className="grid grid-cols-3 gap-4 pt-4 border-t">
        <div>
          <Label className="text-muted-foreground">Type</Label>
          <p className="font-medium capitalize">{config.type}</p>
        </div>
        <div>
          <Label className="text-muted-foreground">Version</Label>
          <p className="font-medium">{config.version}</p>
        </div>
        <div>
          <Label className="text-muted-foreground">Port</Label>
          <p className="font-medium">{config.port}</p>
        </div>
      </div>
    </div>
  )
}
