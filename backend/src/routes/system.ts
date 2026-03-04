import { Elysia, t } from 'elysia';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { jarManager } from '../modules/servers/jar-manager.js';
import type { JavaVersion } from '../types/index.js';
import {
  SystemInfoResponse,
  JavaVersionsResponse,
  ServerTypesResponse,
  MinecraftVersionsResponse,
} from '../schemas/system.js';
import { ErrorResponse } from '../schemas/common.js';

let javaVersionsCache: JavaVersion[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000;

function detectJavaVersions(): JavaVersion[] {
  const versions: JavaVersion[] = [];
  const seenPaths = new Set<string>();

  const addJavaPath = (javaPath: string) => {
    if (seenPaths.has(javaPath)) return;

    try {
      if (!fs.existsSync(javaPath)) return;

      const output = execSync(`"${javaPath}" -version 2>&1`, { encoding: 'utf-8', timeout: 5000 });
      const versionMatch = output.match(/version "([^"]+)"/);
      const vendorMatch = output.match(/^(.+?) version/m);

      if (versionMatch) {
        seenPaths.add(javaPath);
        versions.push({
          version: versionMatch[1],
          path: javaPath,
          vendor: vendorMatch ? vendorMatch[1] : null,
        });
      }
    } catch {
      // Java not valid at this path
    }
  };

  try {
    const javaFromPath = execSync('which java 2>/dev/null || where java 2>nul', { encoding: 'utf-8' }).trim();
    if (javaFromPath) {
      for (const p of javaFromPath.split('\n')) {
        if (p.trim()) addJavaPath(p.trim());
      }
    }
  } catch {
    // No java in PATH
  }

  const javaHome = process.env.JAVA_HOME;
  if (javaHome) {
    addJavaPath(path.join(javaHome, 'bin', 'java'));
  }

  const platform = os.platform();

  if (platform === 'darwin') {
    const macPaths = [
      '/Library/Java/JavaVirtualMachines',
      '/System/Library/Java/JavaVirtualMachines',
      path.join(os.homedir(), 'Library/Java/JavaVirtualMachines'),
    ];

    for (const basePath of macPaths) {
      try {
        if (fs.existsSync(basePath)) {
          const dirs = fs.readdirSync(basePath);
          for (const dir of dirs) {
            addJavaPath(path.join(basePath, dir, 'Contents/Home/bin/java'));
          }
        }
      } catch {
        // Directory not accessible
      }
    }
  } else if (platform === 'linux') {
    const linuxPaths = ['/usr/lib/jvm', '/usr/java', '/opt/java'];

    for (const basePath of linuxPaths) {
      try {
        if (fs.existsSync(basePath)) {
          const dirs = fs.readdirSync(basePath);
          for (const dir of dirs) {
            addJavaPath(path.join(basePath, dir, 'bin/java'));
          }
        }
      } catch {
        // Directory not accessible
      }
    }
  } else if (platform === 'win32') {
    const winPaths = [
      'C:\\Program Files\\Java',
      'C:\\Program Files (x86)\\Java',
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Microsoft\\jdk',
    ];

    for (const basePath of winPaths) {
      try {
        if (fs.existsSync(basePath)) {
          const dirs = fs.readdirSync(basePath);
          for (const dir of dirs) {
            addJavaPath(path.join(basePath, dir, 'bin', 'java.exe'));
          }
        }
      } catch {
        // Directory not accessible
      }
    }
  }

  return versions;
}

function getJavaVersions(forceRefresh = false): JavaVersion[] {
  const now = Date.now();

  if (!forceRefresh && javaVersionsCache && (now - cacheTimestamp) < CACHE_TTL) {
    return javaVersionsCache;
  }

  javaVersionsCache = detectJavaVersions();
  cacheTimestamp = now;

  return javaVersionsCache;
}

export const systemRoutes = new Elysia({ prefix: '/api/system', detail: { tags: ['system'] } })
  .get('/info', () => {
    const totalRamMb = Math.round(os.totalmem() / 1024 / 1024);
    const freeRamMb = Math.round(os.freemem() / 1024 / 1024);

    let javaVersion: string | null = null;
    try {
      const output = execSync('java -version 2>&1', { encoding: 'utf-8' });
      const match = output.match(/version "([^"]+)"/);
      javaVersion = match ? match[1] : null;
    } catch {
      // Java not available
    }

    return {
      totalRamMb,
      freeRamMb,
      cpuCores: os.cpus().length,
      javaVersion,
      platform: os.platform(),
      arch: os.arch(),
      uptime: os.uptime(),
    };
  }, {
    response: {
      200: SystemInfoResponse,
    },
    detail: {
      summary: 'Get system info',
      description: 'Get system resources information including RAM, CPU, Java version, and platform details',
    },
  })
  .get('/java-versions', () => {
    const versions = getJavaVersions();
    return { versions };
  }, {
    response: {
      200: JavaVersionsResponse,
    },
    detail: {
      summary: 'List Java versions',
      description: 'Detect and list all installed Java versions on the system',
    },
  })
  .post('/java-versions/refresh', () => {
    const versions = getJavaVersions(true);
    return { versions };
  }, {
    response: {
      200: JavaVersionsResponse,
    },
    detail: {
      summary: 'Refresh Java versions',
      description: 'Force refresh the Java versions cache',
    },
  })
  .get('/server-types', () => {
    return {
      types: [
        { id: 'vanilla', name: 'Vanilla' },
        { id: 'paper', name: 'Paper' },
      ],
    };
  }, {
    response: {
      200: ServerTypesResponse,
    },
    detail: {
      summary: 'List server types',
      description: 'Get available Minecraft server types',
    },
  })
  .get('/versions/:type', async ({ params, set }) => {
    const { type } = params;

    if (type !== 'vanilla' && type !== 'paper') {
      set.status = 400;
      return {
        error: 'Invalid server type',
        code: 'INVALID_SERVER_TYPE',
      };
    }

    try {
      const versions = await jarManager.getAvailableVersions(type);
      return { versions: versions.map((v) => v.id) };
    } catch (err) {
      console.error(err);
      set.status = 500;
      return {
        error: 'Failed to fetch versions',
        code: 'FETCH_VERSIONS_FAILED',
      };
    }
  }, {
    params: t.Object({
      type: t.String({ description: 'Server type (vanilla or paper)' }),
    }),
    response: {
      200: MinecraftVersionsResponse,
      400: ErrorResponse,
      500: ErrorResponse,
    },
    detail: {
      summary: 'List Minecraft versions',
      description: 'Get available Minecraft versions for a specific server type',
    },
  });
