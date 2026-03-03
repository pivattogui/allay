import { useServerConfig } from '@/hooks/useServerConfig'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { MetadataSection } from './sections/MetadataSection'
import { ResourcesSection } from './sections/ResourcesSection'
import { VersionSection } from './sections/VersionSection'
import { AutomationSection } from './sections/AutomationSection'
import { BackupSection } from './sections/BackupSection'
import { GameSettingsSection } from './sections/GameSettingsSection'

interface ServerSettingsTabProps {
  serverId: string
  isRunning: boolean
}

export function ServerSettingsTab({ serverId, isRunning }: ServerSettingsTabProps) {
  const { data: config, isLoading, error } = useServerConfig(serverId)

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (error || !config) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to load server configuration. Please try again.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-2 overflow-auto h-full">
      <Accordion type="multiple" defaultValue={['metadata', 'resources', 'game']} className="space-y-2">
        <AccordionItem value="metadata" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">Server Identity</span>
          </AccordionTrigger>
          <AccordionContent>
            <MetadataSection serverId={serverId} config={config} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="resources" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <span className="font-medium">Resources</span>
              {isRunning && (
                <span className="text-xs text-muted-foreground">(restart required for changes)</span>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <ResourcesSection serverId={serverId} config={config} isRunning={isRunning} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="version" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">Version & Java</span>
          </AccordionTrigger>
          <AccordionContent>
            <VersionSection serverId={serverId} config={config} isRunning={isRunning} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="automation" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">Automation</span>
          </AccordionTrigger>
          <AccordionContent>
            <AutomationSection serverId={serverId} config={config} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="backup" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <span className="font-medium">Backup Configuration</span>
          </AccordionTrigger>
          <AccordionContent>
            <BackupSection serverId={serverId} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="game" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <span className="font-medium">Game Settings</span>
              <span className="text-xs text-muted-foreground">(server.properties)</span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <GameSettingsSection serverId={serverId} isRunning={isRunning} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
