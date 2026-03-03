import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useUpdateServerConfig, type ServerConfig } from '@/hooks/useServerConfig'
import { useToast } from '@/hooks/use-toast'
import { Loader2, Clock, RotateCcw } from 'lucide-react'

interface AutomationSectionProps {
  serverId: string
  config: ServerConfig
}

export function AutomationSection({ serverId, config }: AutomationSectionProps) {
  const [autoStart, setAutoStart] = useState(config.autoStart)
  const [autoRestart, setAutoRestart] = useState(config.autoRestart)
  const [restartLimit, setRestartLimit] = useState(config.restartLimit.toString())
  const [restartSchedule, setRestartSchedule] = useState(config.restartSchedule || 'none')
  const { toast } = useToast()

  const updateConfig = useUpdateServerConfig(serverId)

  const hasChanges =
    autoStart !== config.autoStart ||
    autoRestart !== config.autoRestart ||
    parseInt(restartLimit) !== config.restartLimit ||
    (restartSchedule === 'none' ? null : restartSchedule) !== config.restartSchedule

  const handleSave = async () => {
    if (!hasChanges) return

    const limit = parseInt(restartLimit)
    if (isNaN(limit) || limit < 0 || limit > 100) {
      toast({ title: 'Restart limit must be between 0 and 100', variant: 'destructive' })
      return
    }

    try {
      await updateConfig.mutateAsync({
        autoStart,
        autoRestart,
        restartLimit: limit,
        restartSchedule: restartSchedule === 'none' ? null : restartSchedule,
      })
      toast({ title: 'Automation settings updated successfully' })
    } catch {
      toast({ title: 'Failed to update automation settings', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-6 pb-4">
      {/* Auto-start Toggle */}
      <div className="flex items-center justify-between space-x-4">
        <div className="space-y-1 flex-1">
          <Label htmlFor="auto-start" className="text-base">
            Auto-start on Launch
          </Label>
          <p className="text-sm text-muted-foreground">
            Automatically start the server when the application launches
          </p>
        </div>
        <Switch
          id="auto-start"
          checked={autoStart}
          onCheckedChange={setAutoStart}
          disabled={updateConfig.isPending}
        />
      </div>

      {/* Auto-restart Toggle */}
      <div className="flex items-center justify-between space-x-4">
        <div className="space-y-1 flex-1">
          <Label htmlFor="auto-restart" className="text-base">
            Auto-restart on Crash
          </Label>
          <p className="text-sm text-muted-foreground">
            Automatically restart the server if it crashes unexpectedly
          </p>
        </div>
        <Switch
          id="auto-restart"
          checked={autoRestart}
          onCheckedChange={setAutoRestart}
          disabled={updateConfig.isPending}
        />
      </div>

      {/* Restart Limit */}
      <div className="space-y-2">
        <Label htmlFor="restart-limit" className="flex items-center gap-2">
          <RotateCcw className="h-4 w-4" />
          Restart Attempt Limit
        </Label>
        <Input
          id="restart-limit"
          type="number"
          min="0"
          max="100"
          value={restartLimit}
          onChange={(e) => setRestartLimit(e.target.value)}
          disabled={updateConfig.isPending}
          className="w-32"
        />
        <p className="text-xs text-muted-foreground">
          Maximum number of restart attempts before giving up (0-100)
        </p>
      </div>

      {/* Restart Schedule */}
      <div className="space-y-2">
        <Label htmlFor="restart-schedule" className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Scheduled Restart
        </Label>
        <Select value={restartSchedule} onValueChange={setRestartSchedule}>
          <SelectTrigger id="restart-schedule" className="w-full">
            <SelectValue placeholder="Select schedule" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="0 0 * * *">Daily at midnight</SelectItem>
            <SelectItem value="0 4 * * *">Daily at 4 AM</SelectItem>
            <SelectItem value="0 0 * * 0">Weekly on Sunday</SelectItem>
            <SelectItem value="0 0 1 * *">Monthly on 1st</SelectItem>
            <SelectItem value="custom">Custom cron expression</SelectItem>
          </SelectContent>
        </Select>

        {restartSchedule === 'custom' && (
          <Input
            placeholder="0 0 * * * (cron format)"
            value={restartSchedule !== 'custom' ? '' : restartSchedule}
            onChange={(e) => setRestartSchedule(e.target.value)}
            disabled={updateConfig.isPending}
            className="font-mono text-sm"
          />
        )}

        <p className="text-xs text-muted-foreground">
          {restartSchedule === 'none'
            ? 'No scheduled restarts'
            : restartSchedule === 'custom'
            ? 'Enter a cron expression (e.g., 0 0 * * * for daily at midnight)'
            : 'Server will restart automatically on this schedule'
          }
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
