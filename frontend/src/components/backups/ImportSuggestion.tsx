import { FileArchive, Globe, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ImportAnalysis } from '@/lib/api'

interface ImportSuggestionProps {
  analysis: ImportAnalysis
  onAcceptPreset: () => void
  onManualSelect: () => void
  loading?: boolean
}

const TYPE_CONFIG = {
  'world-only': {
    icon: Globe,
    title: 'Minecraft world detected',
    getDescription: (a: ImportAnalysis) => {
      const names = a.categories.world.map((w) => w.replace(/\/$/, ''))
      const head = names.slice(0, 3).join(', ')
      const rest = names.length - 3
      return `Contains world data: ${head}${rest > 0 ? `, +${rest} more` : ''}`
    },
  },
  'full-backup': {
    icon: Package,
    title: 'Full server backup detected',
    getDescription: (a: ImportAnalysis) => {
      const parts: string[] = []
      if (a.categories.world.length > 0) parts.push('world')
      if (a.categories.configs.length > 0) parts.push(`${a.categories.configs.length} configs`)
      if (a.categories.plugins.length > 0) parts.push('plugins')
      return `Contains: ${parts.join(', ')}`
    },
  },
  mixed: {
    icon: FileArchive,
    title: 'Archive contents',
    getDescription: (a: ImportAnalysis) => {
      const total =
        a.categories.world.length +
        a.categories.configs.length +
        a.categories.plugins.length +
        a.categories.jars.length +
        a.categories.other.length
      return `${total} items detected — manual selection required`
    },
  },
} as const

const PRESET_LABELS = {
  'world-only': 'Import world only',
  'world-configs': 'Import world + configs',
  'all-except-jars': 'Import all (except JARs)',
} as const

export function ImportSuggestion({ analysis, onAcceptPreset, onManualSelect, loading }: ImportSuggestionProps) {
  const typeConfig = TYPE_CONFIG[analysis.detectedType]
  const Icon = typeConfig.icon

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="font-medium text-foreground">{typeConfig.title}</p>
          <p className="text-sm text-muted-foreground mt-0.5">{typeConfig.getDescription(analysis)}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {analysis.suggestedPreset && (
          <Button onClick={onAcceptPreset} disabled={loading} className="w-full">
            {PRESET_LABELS[analysis.suggestedPreset]}
          </Button>
        )}
        <Button variant="outline" onClick={onManualSelect} disabled={loading} className="w-full">
          Choose manually
        </Button>
      </div>
    </div>
  )
}
