import { AlertTriangle, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { type ServerConfig, useUpdateServerConfig } from '@/hooks/useServerConfig'

interface ResourcesSectionProps {
  serverId: string
  config: ServerConfig
  isRunning: boolean
}

export function ResourcesSection({ serverId, config, isRunning }: ResourcesSectionProps) {
  const [ramMin, setRamMin] = useState(config.ramMinMb)
  const [ramMax, setRamMax] = useState(config.ramMaxMb)
  const [jvmArgs, setJvmArgs] = useState(config.jvmArgs || '')
  const { toast } = useToast()

  const updateConfig = useUpdateServerConfig(serverId)

  const hasChanges = ramMin !== config.ramMinMb || ramMax !== config.ramMaxMb || jvmArgs !== (config.jvmArgs || '')

  const handleSave = async () => {
    if (!hasChanges) return

    if (ramMin > ramMax) {
      toast({ title: 'Minimum RAM cannot exceed maximum RAM', variant: 'destructive' })
      return
    }

    try {
      const result = await updateConfig.mutateAsync({
        ramMinMb: ramMin,
        ramMaxMb: ramMax,
        jvmArgs: jvmArgs || null,
      })
      toast({
        title: 'Resources updated successfully',
        description: result.needsRestart ? 'Server restart required to apply changes' : undefined,
      })
    } catch {
      toast({ title: 'Failed to update resources', variant: 'destructive' })
    }
  }

  const formatRam = (mb: number) => {
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(1)} GB`
    }
    return `${mb} MB`
  }

  return (
    <div className="space-y-6 pb-4">
      {isRunning && (
        <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-500">
          <AlertTriangle className="h-4 w-4" />
          <span>Changes will take effect after server restart</span>
        </div>
      )}

      {/* RAM Configuration */}
      <div className="space-y-4">
        <Label>Memory Allocation</Label>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Minimum</span>
              <Badge variant="outline">{formatRam(ramMin)}</Badge>
            </div>
            <Slider value={[ramMin]} min={512} max={ramMax} step={256} onValueChange={([v]) => setRamMin(v)} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Maximum</span>
              <Badge variant="outline">{formatRam(ramMax)}</Badge>
            </div>
            <Slider value={[ramMax]} min={ramMin} max={32768} step={256} onValueChange={([v]) => setRamMax(v)} />
          </div>
        </div>

        {/* Quick Presets */}
        <div className="flex gap-2">
          <span className="text-sm text-muted-foreground">Presets:</span>
          {[1024, 2048, 4096, 8192].map((preset) => (
            <Button
              key={preset}
              variant="outline"
              size="sm"
              onClick={() => {
                setRamMin(Math.min(preset, ramMin))
                setRamMax(preset)
              }}
            >
              {formatRam(preset)}
            </Button>
          ))}
        </div>
      </div>

      {/* JVM Arguments */}
      <div className="space-y-2">
        <Label htmlFor="jvmArgs">JVM Arguments</Label>
        <Textarea
          id="jvmArgs"
          value={jvmArgs}
          onChange={(e) => setJvmArgs(e.target.value)}
          placeholder="-XX:+UseG1GC -XX:MaxGCPauseMillis=200"
          className="font-mono text-sm"
          rows={3}
        />
        <p className="text-xs text-muted-foreground">
          Custom JVM flags for performance tuning (e.g., -XX:+UseG1GC, -XX:MaxGCPauseMillis=200)
        </p>
      </div>

      {/* Save Button */}
      <Button onClick={handleSave} disabled={!hasChanges || updateConfig.isPending}>
        {updateConfig.isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Saving...
          </>
        ) : (
          'Save Changes'
        )}
      </Button>
    </div>
  )
}
