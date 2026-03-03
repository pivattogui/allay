import { ChevronRight, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface FileBreadcrumbProps {
  path: string;
  onNavigate: (path: string) => void;
}

export function FileBreadcrumb({ path, onNavigate }: FileBreadcrumbProps) {
  const segments = path ? path.split('/').filter(Boolean) : [];

  const handleNavigate = (index: number) => {
    if (index < 0) {
      onNavigate('');
    } else {
      const newPath = segments.slice(0, index + 1).join('/');
      onNavigate(newPath);
    }
  };

  return (
    <div className="flex items-center gap-1 min-w-0 overflow-hidden">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 flex-shrink-0"
        onClick={() => handleNavigate(-1)}
      >
        <Home className="h-4 w-4" />
      </Button>

      {segments.map((segment, index) => (
        <div key={index} className="flex items-center min-w-0">
          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 min-w-0"
            onClick={() => handleNavigate(index)}
          >
            <span className="truncate max-w-[150px]">{segment}</span>
          </Button>
        </div>
      ))}

      {segments.length === 0 && (
        <span className="text-sm text-muted-foreground ml-2">Root</span>
      )}
    </div>
  );
}
