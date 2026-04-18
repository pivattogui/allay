import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ArrowLeft, Server, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useCreateServer } from '@/hooks/useServerActions'

interface ServerType {
  id: string
  name: string
}

export function CreateServerPage() {
  const navigate = useNavigate()
  const createServerMutation = useCreateServer()

  // Form state
  const [name, setName] = useState('')
  const [type, setType] = useState('')
  const [version, setVersion] = useState('')
  const [port, setPort] = useState('25565')
  const [ramMin, setRamMin] = useState('1024')
  const [ramMax, setRamMax] = useState('2048')

  // Port range from system config
  const [portRange, setPortRange] = useState({ min: 25565, max: 25575 })

  // Server types fetched from API
  const [serverTypes, setServerTypes] = useState<ServerType[]>([])
  const [loadingTypes, setLoadingTypes] = useState(true)

  // Versions fetched from API
  const [availableVersions, setAvailableVersions] = useState<string[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)

  const loading = createServerMutation.isPending

  // Fetch port range on mount
  useEffect(() => {
    const loadPortRange = async () => {
      try {
        const token = localStorage.getItem('token')
        const res = await fetch('/api/system/info', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          const data = await res.json()
          if (data.portRange) {
            setPortRange(data.portRange)
            setPort(String(data.portRange.min))
          }
        }
      } catch (err) {
        console.error('Failed to fetch port range:', err)
      }
    }
    loadPortRange()
  }, [])

  // Fetch server types on mount
  useEffect(() => {
    const fetchTypes = async () => {
      try {
        const token = localStorage.getItem('token')
        const res = await fetch('/api/system/server-types', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          const data = await res.json()
          setServerTypes(data.types || [])
          if (data.types?.length > 0) {
            setType(data.types[0].id)
          }
        }
      } catch (err) {
        console.error('Failed to fetch server types:', err)
      } finally {
        setLoadingTypes(false)
      }
    }

    fetchTypes()
  }, [])

  // Fetch versions when type changes
  useEffect(() => {
    if (!type) return

    const fetchVersions = async () => {
      setLoadingVersions(true)
      setVersion('')
      try {
        const token = localStorage.getItem('token')
        const res = await fetch(`/api/system/versions/${type}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          const data = await res.json()
          setAvailableVersions(data.versions || [])
          if (data.versions?.length > 0) {
            setVersion(data.versions[0])
          }
        }
      } catch (err) {
        console.error('Failed to fetch versions:', err)
        setAvailableVersions([])
      } finally {
        setLoadingVersions(false)
      }
    }

    fetchVersions()
  }, [type])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      toast.error('Server name is required')
      return
    }

    if (!version) {
      toast.error('Please select a version')
      return
    }

    const portNum = parseInt(port, 10)
    if (isNaN(portNum) || portNum < portRange.min || portNum > portRange.max) {
      toast.error(`Port must be between ${portRange.min} and ${portRange.max}`)
      return
    }

    const ramMinNum = parseInt(ramMin, 10)
    const ramMaxNum = parseInt(ramMax, 10)
    if (isNaN(ramMinNum) || isNaN(ramMaxNum) || ramMinNum < 512 || ramMaxNum < ramMinNum) {
      toast.error('Invalid RAM configuration')
      return
    }

    try {
      await createServerMutation.mutateAsync({
        name: name.trim(),
        type,
        version,
        port: portNum,
        ramMinMb: ramMinNum,
        ramMaxMb: ramMaxNum,
      })
      toast.success('Server created successfully')
      navigate('/servers')
    } catch {
      toast.error('Failed to create server')
    }
  }

  return (
    <div className="min-h-full bg-background">
      {/* Header */}
      <div className="border-b border-border bg-background">
        <div className="px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/servers')}
              className="text-muted-foreground"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Servers
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <h1 className="text-lg font-semibold text-foreground">Create New Server</h1>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="max-w-2xl mx-auto p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Server className="h-4 w-4" />
                Server Configuration
              </CardTitle>
              <CardDescription>Configure your new Minecraft server</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium text-foreground">
                  Server Name
                </label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Minecraft Server"
                  required
                  disabled={loading}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label htmlFor="type" className="text-sm font-medium text-foreground">
                    Server Type
                  </label>
                  <Select
                    value={type || undefined}
                    onValueChange={setType}
                    disabled={loading || loadingTypes}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={loadingTypes ? 'Loading...' : 'Select type'} />
                    </SelectTrigger>
                    <SelectContent>
                      {serverTypes.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label htmlFor="version" className="text-sm font-medium text-foreground">
                    Version
                  </label>
                  <Select
                    value={version || undefined}
                    onValueChange={setVersion}
                    disabled={loading || loadingVersions || !type}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={loadingVersions ? 'Loading...' : 'Select version'} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableVersions.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="port" className="text-sm font-medium text-foreground">
                  Port
                </label>
                <Input
                  id="port"
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder={String(portRange.min)}
                  min={portRange.min}
                  max={portRange.max}
                  required
                  disabled={loading}
                />
                <p className="text-xs text-muted-foreground">Allowed range: {portRange.min}–{portRange.max}</p>
              </div>

              <Separator />

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Memory (RAM)</label>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Input
                      type="number"
                      value={ramMin}
                      onChange={(e) => setRamMin(e.target.value)}
                      placeholder="1024"
                      min={512}
                      required
                      disabled={loading}
                    />
                    <p className="text-xs text-muted-foreground mt-1">Minimum (MB)</p>
                  </div>
                  <div>
                    <Input
                      type="number"
                      value={ramMax}
                      onChange={(e) => setRamMax(e.target.value)}
                      placeholder="2048"
                      min={512}
                      required
                      disabled={loading}
                    />
                    <p className="text-xs text-muted-foreground mt-1">Maximum (MB)</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => navigate('/servers')} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Server'
              )}
            </Button>
          </div>

        </form>
      </div>
    </div>
  )
}
