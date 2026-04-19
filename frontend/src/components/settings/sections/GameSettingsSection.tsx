import { AlertTriangle, Loader2, RotateCcw, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { useServerProperties, useUpdateServerProperties } from '@/hooks/useServerProperties'

interface GameSettingsSectionProps {
  serverId: string
  isRunning: boolean
}

interface GameSettings {
  motd: string
  'max-players': string
  difficulty: string
  gamemode: string
  pvp: string
  hardcore: string
  'spawn-protection': string
  'view-distance': string
}

const DIFFICULTY_OPTIONS = ['peaceful', 'easy', 'normal', 'hard']
const GAMEMODE_OPTIONS = ['survival', 'creative', 'adventure', 'spectator']

export function GameSettingsSection({ serverId, isRunning }: GameSettingsSectionProps) {
  const { data: properties, isLoading } = useServerProperties(serverId)
  const updateProperties = useUpdateServerProperties(serverId)
  const { toast } = useToast()

  // Extract game-specific settings
  const [settings, setSettings] = useState<Partial<GameSettings>>({})
  const [hasChanges, setHasChanges] = useState(false)

  // Initialize settings when properties load
  useEffect(() => {
    if (properties) {
      setSettings({
        motd: properties.motd || 'A Minecraft Server',
        'max-players': properties['max-players'] || '20',
        difficulty: properties.difficulty || 'normal',
        gamemode: properties.gamemode || 'survival',
        pvp: properties.pvp || 'true',
        hardcore: properties.hardcore || 'false',
        'spawn-protection': properties['spawn-protection'] || '16',
        'view-distance': properties['view-distance'] || '10',
      })
      setHasChanges(false)
    }
  }, [properties])

  const handleChange = (key: keyof GameSettings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setHasChanges(true)
  }

  const handleBooleanChange = (key: keyof GameSettings, checked: boolean) => {
    handleChange(key, checked ? 'true' : 'false')
  }

  const handleSave = async () => {
    if (!properties) return

    try {
      // Merge updated settings with existing properties
      const updatedProperties = { ...properties, ...settings }
      await updateProperties.mutateAsync(updatedProperties)
      toast({
        title: 'Game settings saved',
        description: isRunning ? 'Server restart required to apply changes' : undefined,
      })
      setHasChanges(false)
    } catch {
      toast({ title: 'Failed to save game settings', variant: 'destructive' })
    }
  }

  const handleReset = () => {
    if (properties) {
      setSettings({
        motd: properties.motd || 'A Minecraft Server',
        'max-players': properties['max-players'] || '20',
        difficulty: properties.difficulty || 'normal',
        gamemode: properties.gamemode || 'survival',
        pvp: properties.pvp || 'true',
        hardcore: properties.hardcore || 'false',
        'spawn-protection': properties['spawn-protection'] || '16',
        'view-distance': properties['view-distance'] || '10',
      })
      setHasChanges(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4 pb-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  if (!properties) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>Failed to load server.properties</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-6 pb-4">
      {isRunning && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>Changes will take effect after server restart</AlertDescription>
        </Alert>
      )}

      {/* MOTD */}
      <div className="space-y-2">
        <Label htmlFor="motd">Message of the Day (MOTD)</Label>
        <Input
          id="motd"
          value={settings.motd || ''}
          onChange={(e) => handleChange('motd', e.target.value)}
          placeholder="A Minecraft Server"
        />
        <p className="text-xs text-muted-foreground">Message displayed in the server list</p>
      </div>

      {/* Max Players */}
      <div className="space-y-2">
        <Label htmlFor="max-players">Max Players</Label>
        <Input
          id="max-players"
          type="number"
          min="1"
          max="1000"
          value={settings['max-players'] || ''}
          onChange={(e) => handleChange('max-players', e.target.value)}
        />
        <p className="text-xs text-muted-foreground">Maximum number of concurrent players (1-1000)</p>
      </div>

      {/* Difficulty */}
      <div className="space-y-2">
        <Label htmlFor="difficulty">Difficulty</Label>
        <Select value={settings.difficulty} onValueChange={(value) => handleChange('difficulty', value)}>
          <SelectTrigger id="difficulty">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DIFFICULTY_OPTIONS.map((diff) => (
              <SelectItem key={diff} value={diff}>
                {diff.charAt(0).toUpperCase() + diff.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Gamemode */}
      <div className="space-y-2">
        <Label htmlFor="gamemode">Default Gamemode</Label>
        <Select value={settings.gamemode} onValueChange={(value) => handleChange('gamemode', value)}>
          <SelectTrigger id="gamemode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GAMEMODE_OPTIONS.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* View Distance */}
      <div className="space-y-2">
        <Label htmlFor="view-distance">View Distance (chunks)</Label>
        <Input
          id="view-distance"
          type="number"
          min="3"
          max="32"
          value={settings['view-distance'] || ''}
          onChange={(e) => handleChange('view-distance', e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Render distance in chunks (3-32, higher = more performance impact)
        </p>
      </div>

      {/* Spawn Protection */}
      <div className="space-y-2">
        <Label htmlFor="spawn-protection">Spawn Protection (blocks)</Label>
        <Input
          id="spawn-protection"
          type="number"
          min="0"
          max="100"
          value={settings['spawn-protection'] || ''}
          onChange={(e) => handleChange('spawn-protection', e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Radius around spawn point where non-ops cannot break/place blocks
        </p>
      </div>

      {/* Boolean Settings */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="pvp">PVP Enabled</Label>
            <p className="text-xs text-muted-foreground">Allow players to damage each other</p>
          </div>
          <Switch
            id="pvp"
            checked={settings.pvp === 'true'}
            onCheckedChange={(checked) => handleBooleanChange('pvp', checked)}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="hardcore">Hardcore Mode</Label>
            <p className="text-xs text-muted-foreground">Players are banned on death, difficulty locked to hard</p>
          </div>
          <Switch
            id="hardcore"
            checked={settings.hardcore === 'true'}
            onCheckedChange={(checked) => handleBooleanChange('hardcore', checked)}
          />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 pt-4">
        <Button onClick={handleSave} disabled={!hasChanges || updateProperties.isPending}>
          {updateProperties.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Save Changes
            </>
          )}
        </Button>
        {hasChanges && (
          <Button variant="outline" onClick={handleReset}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </Button>
        )}
      </div>
    </div>
  )
}
