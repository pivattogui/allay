import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  LayoutGrid,
  Plus,
  LogOut,
  ChevronRight,
} from 'lucide-react';
import { useServers } from '@/hooks/useServers';
import { useAuthStore } from '@/stores';

export function Sidebar() {
  const location = useLocation();
  const currentPath = location.pathname;
  const { data: servers = [] } = useServers();
  const logout = useAuthStore((s) => s.logout);

  const isActive = (path: string) => {
    if (path === '/servers' && currentPath === '/servers') return true;
    if (path !== '/servers' && currentPath.startsWith(path)) return true;
    return false;
  };

  const runningServers = servers.filter((s) => s.status.state === 'running').length;

  return (
    <div className="flex h-screen w-[220px] flex-col border-r border-border bg-background">
      {/* Logo */}
      <div className="flex h-14 items-center px-4">
        <Link to="/servers" className="flex items-center gap-2.5">
          <img src="/allay-icon.svg" alt="Allay" className="h-7 w-7" />
          <span className="font-semibold text-foreground tracking-wide">Allay</span>
        </Link>
      </div>

      <Separator />

      {/* Navigation */}
      <ScrollArea className="flex-1 px-3 py-4">
        <div className="space-y-1">
          <Link to="/servers">
            <Button
              variant={currentPath === '/servers' ? 'secondary' : 'ghost'}
              className="w-full justify-start"
              size="sm"
            >
              <LayoutGrid className="mr-2 h-4 w-4" />
              Overview
            </Button>
          </Link>
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Servers
            </span>
            <span className="text-xs text-muted-foreground">
              {runningServers}/{servers.length}
            </span>
          </div>

          <div className="space-y-1">
            {servers.map((server) => (
              <Link key={server.id} to={`/servers/${server.id}`}>
                <Button
                  variant={isActive(`/servers/${server.id}`) ? 'secondary' : 'ghost'}
                  className="w-full justify-start group"
                  size="sm"
                >
                  <span
                    className={cn(
                      'mr-2 h-2 w-2 rounded-full',
                      server.status.state === 'running' && 'bg-green-500 status-pulse',
                      server.status.state === 'starting' && 'bg-yellow-500',
                      server.status.state === 'stopping' && 'bg-yellow-500',
                      server.status.state === 'crashed' && 'bg-red-500',
                      server.status.state === 'stopped' && 'bg-muted-foreground'
                    )}
                  />
                  <span className="truncate flex-1 text-left">{server.name}</span>
                  <ChevronRight className="h-4 w-4 opacity-0 group-hover:opacity-50 transition-opacity" />
                </Button>
              </Link>
            ))}

            {servers.length === 0 && (
              <p className="px-2 py-4 text-sm text-muted-foreground text-center">
                No servers yet
              </p>
            )}
          </div>

          <Link to="/servers/new" className="block mt-2">
            <Button variant="outline" className="w-full justify-start" size="sm">
              <Plus className="mr-2 h-4 w-4" />
              New Server
            </Button>
          </Link>
        </div>
      </ScrollArea>

      <Separator />

      {/* Footer */}
      <div className="p-3">
        <Button
          variant="ghost"
          className="w-full justify-start text-muted-foreground hover:text-destructive"
          size="sm"
          onClick={logout}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Logout
        </Button>
      </div>
    </div>
  );
}
