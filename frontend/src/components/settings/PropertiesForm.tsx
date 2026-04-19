import { Loader2, RefreshCw, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'

interface PropertiesFormProps {
  serverId: string
  serverName: string
}

interface Property {
  key: string
  value: string
  type: 'string' | 'number' | 'boolean'
}

// Common Minecraft server properties grouped by category
const propertyCategories: Record<string, string[]> = {
  General: ['server-name', 'motd', 'max-players', 'white-list', 'online-mode'],
  World: ['level-name', 'level-seed', 'level-type', 'gamemode', 'difficulty', 'spawn-protection'],
  Network: ['server-port', 'server-ip', 'query.port', 'enable-query', 'enable-rcon', 'rcon.port'],
  Performance: ['view-distance', 'simulation-distance', 'max-tick-time', 'network-compression-threshold'],
  Gameplay: ['pvp', 'allow-flight', 'allow-nether', 'spawn-monsters', 'spawn-animals', 'hardcore'],
}

function inferType(value: string): 'string' | 'number' | 'boolean' {
  if (value === 'true' || value === 'false') return 'boolean'
  if (!Number.isNaN(Number(value)) && value.trim() !== '') return 'number'
  return 'string'
}

export function PropertiesForm({ serverId, serverName: _serverName }: PropertiesFormProps) {
  const [properties, setProperties] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [originalProperties, setOriginalProperties] = useState<Record<string, string>>({})

  const fetchProperties = async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/servers/${serverId}/properties`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setProperties(data.properties || {})
        setOriginalProperties(data.properties || {})
        setHasChanges(false)
      }
    } catch (_err) {
      toast.error('Failed to load server properties')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchProperties()
  }, [fetchProperties])

  const handleChange = (key: string, value: string) => {
    setProperties((prev) => ({ ...prev, [key]: value }))
    setHasChanges(true)
  }

  const handleBooleanChange = (key: string, checked: boolean) => {
    handleChange(key, checked ? 'true' : 'false')
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/servers/${serverId}/properties`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ properties }),
      })
      if (res.ok) {
        toast.success('Properties saved successfully')
        setOriginalProperties(properties)
        setHasChanges(false)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save properties')
      }
    } catch (_err) {
      toast.error('Failed to save properties')
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    setProperties(originalProperties)
    setHasChanges(false)
  }

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-24" />
        </div>
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-24" />
            </CardHeader>
            <CardContent className="space-y-4">
              {[1, 2, 3].map((j) => (
                <Skeleton key={j} className="h-10 w-full" />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  // Group properties by category
  const categorizedProperties: Record<string, Property[]> = {}
  const uncategorized: Property[] = []

  Object.entries(properties).forEach(([key, value]) => {
    const prop: Property = { key, value, type: inferType(value) }
    let found = false

    for (const [category, keys] of Object.entries(propertyCategories)) {
      if (keys.includes(key)) {
        if (!categorizedProperties[category]) {
          categorizedProperties[category] = []
        }
        categorizedProperties[category].push(prop)
        found = true
        break
      }
    }

    if (!found) {
      uncategorized.push(prop)
    }
  })

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-medium text-foreground">Server Properties</h2>
          <p className="text-sm text-muted-foreground">Configure server.properties settings</p>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <Button variant="outline" onClick={handleReset}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Reset
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving || !hasChanges}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Property Categories */}
      {Object.entries(categorizedProperties).map(([category, props]) => (
        <Card key={category}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{category}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {props.map((prop) => (
              <div key={prop.key} className="flex items-center gap-4">
                <label className="w-48 text-sm text-muted-foreground flex-shrink-0">{prop.key}</label>
                {prop.type === 'boolean' ? (
                  <Switch
                    checked={prop.value === 'true'}
                    onCheckedChange={(checked) => handleBooleanChange(prop.key, checked)}
                  />
                ) : (
                  <Input
                    value={prop.value}
                    onChange={(e) => handleChange(prop.key, e.target.value)}
                    type={prop.type === 'number' ? 'number' : 'text'}
                    className="flex-1"
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {/* Uncategorized */}
      {uncategorized.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Other</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {uncategorized.map((prop) => (
              <div key={prop.key} className="flex items-center gap-4">
                <label className="w-48 text-sm text-muted-foreground flex-shrink-0">{prop.key}</label>
                {prop.type === 'boolean' ? (
                  <Switch
                    checked={prop.value === 'true'}
                    onCheckedChange={(checked) => handleBooleanChange(prop.key, checked)}
                  />
                ) : (
                  <Input
                    value={prop.value}
                    onChange={(e) => handleChange(prop.key, e.target.value)}
                    type={prop.type === 'number' ? 'number' : 'text'}
                    className="flex-1"
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
