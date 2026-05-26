import { ChevronDown, ChevronRight } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { ImportAnalysis, ImportSelection } from '@/lib/api'

interface ImportManualSelectionProps {
  analysis: ImportAnalysis
  onConfirm: (selection: ImportSelection) => void
  onBack: () => void
  loading?: boolean
}

type CategoryKey = keyof ImportAnalysis['categories']

const CATEGORY_LABELS: Record<CategoryKey, string> = {
  world: 'World',
  configs: 'Configurations',
  plugins: 'Plugins',
  jars: 'Server JARs',
  logs: 'Logs',
  other: 'Other',
}

const PRESETS: { key: NonNullable<ImportSelection['preset']>; label: string }[] = [
  { key: 'world-only', label: 'World only' },
  { key: 'world-configs', label: 'World + configs' },
  { key: 'all-except-jars', label: 'All except JARs' },
]

function getPresetCategories(preset: NonNullable<ImportSelection['preset']>): CategoryKey[] {
  switch (preset) {
    case 'world-only':
      return ['world']
    case 'world-configs':
      return ['world', 'configs']
    case 'all-except-jars':
      return ['world', 'configs', 'plugins', 'other']
  }
}

export function ImportManualSelection({ analysis, onConfirm, onBack, loading }: ImportManualSelectionProps) {
  const [selectedCategories, setSelectedCategories] = useState<Set<CategoryKey>>(() => {
    if (analysis.suggestedPreset) {
      return new Set(getPresetCategories(analysis.suggestedPreset))
    }
    return new Set<CategoryKey>()
  })
  const [expandedCategories, setExpandedCategories] = useState<Set<CategoryKey>>(new Set())

  const nonEmptyCategories = useMemo(
    () => (Object.keys(analysis.categories) as CategoryKey[]).filter((k) => analysis.categories[k].length > 0),
    [analysis.categories],
  )

  const selectedCount = useMemo(() => {
    let count = 0
    for (const cat of selectedCategories) {
      count += analysis.categories[cat].length
    }
    return count
  }, [selectedCategories, analysis.categories])

  const toggleCategory = useCallback((cat: CategoryKey) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) {
        next.delete(cat)
      } else {
        next.add(cat)
      }
      return next
    })
  }, [])

  const toggleExpanded = useCallback((cat: CategoryKey) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) {
        next.delete(cat)
      } else {
        next.add(cat)
      }
      return next
    })
  }, [])

  const applyPreset = useCallback((preset: NonNullable<ImportSelection['preset']>) => {
    setSelectedCategories(new Set(getPresetCategories(preset)))
  }, [])

  const handleConfirm = useCallback(() => {
    const include = [...selectedCategories].flatMap((cat) => analysis.categories[cat])
    onConfirm({ preset: null, include, exclude: [] })
  }, [selectedCategories, analysis.categories, onConfirm])

  return (
    <div className="space-y-4">
      {/* Preset buttons */}
      <div className="flex flex-wrap gap-2">
        {PRESETS.map(({ key, label }) => (
          <Button key={key} variant="outline" size="sm" onClick={() => applyPreset(key)} disabled={loading}>
            {label}
          </Button>
        ))}
      </div>

      {/* Category tree */}
      <div className="rounded-lg border divide-y max-h-64 overflow-y-auto">
        {nonEmptyCategories.map((cat) => (
          <div key={cat}>
            <div className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50">
              <Checkbox
                checked={selectedCategories.has(cat)}
                onCheckedChange={() => toggleCategory(cat)}
                disabled={loading}
              />
              <button
                type="button"
                className="flex items-center gap-1 flex-1 text-left text-sm"
                onClick={() => toggleExpanded(cat)}
              >
                {expandedCategories.has(cat) ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="font-medium">{CATEGORY_LABELS[cat]}</span>
                <span className="text-muted-foreground ml-1">({analysis.categories[cat].length})</span>
              </button>
            </div>
            {expandedCategories.has(cat) && (
              <div className="pl-10 pb-2 space-y-0.5">
                {analysis.categories[cat].map((entry) => (
                  <p key={entry} className="text-xs text-muted-foreground truncate py-0.5">
                    {entry}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{selectedCount} items selected</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onBack} disabled={loading}>
            Back
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={loading || selectedCount === 0}>
            Import selection
          </Button>
        </div>
      </div>
    </div>
  )
}
