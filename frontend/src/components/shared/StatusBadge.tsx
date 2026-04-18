import { Badge } from '@/components/ui/badge';

export function StatusBadge({ state }: { state: string }) {
  switch (state) {
    case 'running':
      return <Badge variant="success">Running</Badge>;
    case 'starting':
      return <Badge variant="warning">Starting</Badge>;
    case 'stopping':
      return <Badge variant="warning">Stopping</Badge>;
    case 'crashed':
      return <Badge variant="destructive">Crashed</Badge>;
    default:
      return <Badge variant="secondary">Stopped</Badge>;
  }
}
