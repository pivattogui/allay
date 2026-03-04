import { t } from 'elysia';
import { ServerType } from './common.js';

// Java version
export const JavaVersion = t.Object({
  version: t.String({ description: 'Java version string' }),
  path: t.String({ description: 'Path to Java executable' }),
  vendor: t.Nullable(t.String({ description: 'Java vendor' })),
});

// System info response
export const SystemInfoResponse = t.Object({
  totalRamMb: t.Number({ description: 'Total system RAM in MB' }),
  freeRamMb: t.Number({ description: 'Available RAM in MB' }),
  cpuCores: t.Number({ description: 'Number of CPU cores' }),
  javaVersion: t.Nullable(t.String({ description: 'Default Java version' })),
  platform: t.String({ description: 'Operating system' }),
  arch: t.String({ description: 'CPU architecture' }),
  uptime: t.Number({ description: 'System uptime in seconds' }),
});

// Java versions response
export const JavaVersionsResponse = t.Object({
  versions: t.Array(JavaVersion),
});

// Server types response
export const ServerTypesResponse = t.Object({
  types: t.Array(t.Object({
    id: t.String({ description: 'Type ID' }),
    name: t.String({ description: 'Type display name' }),
  })),
});

// Minecraft versions response
export const MinecraftVersionsResponse = t.Object({
  versions: t.Array(t.String({ description: 'Minecraft version' })),
});

// Type param
export const TypeParam = t.Object({
  type: ServerType,
});
