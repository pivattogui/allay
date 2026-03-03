import { useMemo } from 'react';
import { ServerMetrics } from '@/hooks/useWebSocket';
import { Cpu, MemoryStick, Users, Power } from 'lucide-react';
import { SparkLine } from '@/components/ui/sparkline';

interface MetricsChartProps {
  history: ServerMetrics[];
  maxPoints?: number;
  isRunning?: boolean;
}

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  subValue?: string;
  percentage: number;
  color: 'blue' | 'emerald' | 'violet';
  data: number[];
  rawData: number[];
  unit: string;
}

const colorHex = {
  blue: '#3b82f6',
  emerald: '#10b981',
  violet: '#8b5cf6',
};

function MetricCard({ icon, label, value, subValue, percentage, color, data, rawData, unit }: MetricCardProps) {
  const colorClasses = {
    blue: 'bg-blue-500',
    emerald: 'bg-emerald-500',
    violet: 'bg-violet-500',
  };

  return (
    <div className="rounded-xl bg-zinc-900/50 p-4 ring-1 ring-white/5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-zinc-400">
          {icon}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <div className="text-right">
          <span className="text-lg font-semibold text-white">{value}</span>
          {subValue && (
            <span className="text-sm text-zinc-500 ml-1">{subValue}</span>
          )}
        </div>
      </div>

      {/* Sparkline Chart */}
      <div className="mb-3">
        <SparkLine data={data} rawData={rawData} unit={unit} color={colorHex[color]} height={36} />
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${colorClasses[color]} rounded-full transition-all duration-500`}
          style={{ width: `${Math.min(100, percentage)}%` }}
        />
      </div>
    </div>
  );
}

export function MetricsChart({ history, maxPoints = 30, isRunning = true }: MetricsChartProps) {
  const data = useMemo(() => {
    const points = history.slice(-maxPoints);
    if (points.length === 0) return { cpu: [], ram: [], players: [], cpuRaw: [], ramRaw: [], playersRaw: [], maxRam: 100, ramPercent: 0, playerPercent: 0 };

    const maxRam = Math.max(...points.map((p) => p.ramMaxMb || p.ramUsedMb * 2), 1024);
    const latestRam = points[points.length - 1]?.ramUsedMb || 0;
    const latestMaxRam = points[points.length - 1]?.ramMaxMb || maxRam;
    const latestPlayers = points[points.length - 1]?.playerCount || 0;
    const latestMaxPlayers = points[points.length - 1]?.playerMax || 20;

    return {
      cpu: points.map((p) => Math.min(100, p.cpuPercent)),
      ram: points.map((p) => (p.ramUsedMb / maxRam) * 100),
      players: points.map((p) => ((p.playerCount || 0) / (p.playerMax || 20)) * 100),
      cpuRaw: points.map((p) => p.cpuPercent),
      ramRaw: points.map((p) => p.ramUsedMb),
      playersRaw: points.map((p) => p.playerCount || 0),
      maxRam: latestMaxRam,
      ramPercent: (latestRam / latestMaxRam) * 100,
      playerPercent: (latestPlayers / latestMaxPlayers) * 100,
    };
  }, [history, maxPoints]);

  const latest = history[history.length - 1];

  // Show offline state when server is not running
  if (!isRunning) {
    return (
      <div className="rounded-xl bg-zinc-900/50 p-6 ring-1 ring-white/5">
        <div className="flex flex-col items-center justify-center py-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800 mb-3">
            <Power className="h-6 w-6 text-zinc-500" />
          </div>
          <h3 className="text-sm font-medium text-zinc-300 mb-1">Server Offline</h3>
          <p className="text-xs text-zinc-500 max-w-xs">
            Start the server to view real-time metrics including CPU, memory usage, and player count.
          </p>
        </div>
      </div>
    );
  }

  // Show loading skeleton when waiting for metrics data
  if (history.length === 0) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {['CPU', 'Memory', 'Players'].map((label) => (
          <div
            key={label}
            className="rounded-xl bg-zinc-900/50 p-4 ring-1 ring-white/5 animate-pulse"
          >
            <div className="flex justify-between mb-4">
              <div className="h-4 bg-zinc-800 rounded w-16" />
              <div className="h-4 bg-zinc-800 rounded w-12" />
            </div>
            <div className="h-10 bg-zinc-800/50 rounded mb-3" />
            <div className="h-1 bg-zinc-800 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  const cpuValue = latest?.cpuPercent ?? 0;
  const ramUsed = latest?.ramUsedMb ?? 0;
  const ramMax = latest?.ramMaxMb || data.maxRam;
  const playerCount = latest?.playerCount ?? 0;
  const playerMax = latest?.playerMax ?? 20;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <MetricCard
        icon={<Cpu className="w-4 h-4" />}
        label="CPU"
        value={`${cpuValue.toFixed(1)}%`}
        percentage={cpuValue}
        color="blue"
        data={data.cpu}
        rawData={data.cpuRaw}
        unit="%"
      />

      <MetricCard
        icon={<MemoryStick className="w-4 h-4" />}
        label="Memory"
        value={formatBytes(ramUsed * 1024 * 1024)}
        subValue={`/ ${formatBytes(ramMax * 1024 * 1024)}`}
        percentage={data.ramPercent}
        color="emerald"
        data={data.ram}
        rawData={data.ramRaw}
        unit=" MB"
      />

      <MetricCard
        icon={<Users className="w-4 h-4" />}
        label="Players"
        value={`${playerCount}`}
        subValue={`/ ${playerMax}`}
        percentage={data.playerPercent}
        color="violet"
        data={data.players}
        rawData={data.playersRaw}
        unit=""
      />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}
