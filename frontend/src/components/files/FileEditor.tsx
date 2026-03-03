import { useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Save, X, Loader2, AlertTriangle } from 'lucide-react';

interface FileEditorProps {
  filePath: string;
  fileName: string;
  content: string;
  sensitive?: boolean;
  onChange: (content: string) => void;
  onSave: () => void;
  onClose: () => void;
  isModified: boolean;
  isSaving: boolean;
}

export function FileEditor({
  filePath,
  fileName,
  content,
  sensitive,
  onChange,
  onSave,
  onClose,
  isModified,
  isSaving,
}: FileEditorProps) {
  // Keyboard shortcut for save
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (isModified && !isSaving) {
          onSave();
        }
      }
    },
    [isModified, isSaving, onSave]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isModified) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isModified]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-border flex items-center justify-between bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate">{fileName}</span>
          {isModified && (
            <Badge variant="secondary" className="text-xs">
              Modified
            </Badge>
          )}
          {sensitive && (
            <Badge variant="outline" className="text-xs text-yellow-500 border-yellow-500/50">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Sensitive
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={onSave}
            disabled={!isModified || isSaving}
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Path info */}
      <div className="flex-shrink-0 px-4 py-1 border-b border-border bg-muted/20">
        <span className="text-xs text-muted-foreground font-mono">{filePath}</span>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <textarea
          value={content}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-full p-4 bg-background text-foreground font-mono text-sm resize-none focus:outline-none"
          spellCheck={false}
          placeholder="Empty file..."
        />
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-4 py-1 border-t border-border bg-muted/20 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {content.split('\n').length} lines · {new Blob([content]).size} bytes
        </span>
        <span className="text-xs text-muted-foreground">
          Press <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Ctrl+S</kbd> to save
        </span>
      </div>
    </div>
  );
}
