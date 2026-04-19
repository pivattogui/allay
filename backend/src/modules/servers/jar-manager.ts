import fs from 'node:fs'
import path from 'node:path'
import { config } from '../../config.js'
import type { MinecraftVersion, ServerType } from '../../types/index.js'

interface VanillaManifest {
  latest: { release: string; snapshot: string }
  versions: Array<{
    id: string
    type: 'release' | 'snapshot'
    url: string
    releaseTime: string
  }>
}

interface VanillaVersionData {
  downloads: {
    server: { url: string; sha1: string }
  }
}

interface PaperVersions {
  versions: string[]
}

interface PaperBuilds {
  builds: Array<{
    build: number
    channel: string
  }>
}

interface PaperBuildInfo {
  downloads: {
    application: { name: string }
  }
}

class JarManager {
  private readonly vanillaManifestUrl = 'https://launchermeta.mojang.com/mc/game/version_manifest.json'
  private readonly paperApiUrl = 'https://api.papermc.io/v2'
  private readonly fetchOptions = {
    headers: {
      'User-Agent': 'MC-Manager/1.0',
      Accept: 'application/json',
    },
  }

  async getAvailableVersions(type: ServerType): Promise<MinecraftVersion[]> {
    if (type === 'vanilla') {
      return this.getVanillaVersions()
    } else {
      return this.getPaperVersions()
    }
  }

  private async getVanillaVersions(): Promise<MinecraftVersion[]> {
    const response = await fetch(this.vanillaManifestUrl, this.fetchOptions)
    const manifest = (await response.json()) as VanillaManifest

    return manifest.versions
      .filter((v) => v.type === 'release')
      .slice(0, 20) // Last 20 releases
      .map((v) => ({
        id: v.id,
        type: v.type,
        releaseTime: v.releaseTime,
      }))
  }

  private async getPaperVersions(): Promise<MinecraftVersion[]> {
    const response = await fetch(`${this.paperApiUrl}/projects/paper`, this.fetchOptions)
    const data = (await response.json()) as PaperVersions

    return data.versions
      .reverse()
      .slice(0, 20) // Last 20 versions
      .map((id) => ({
        id,
        type: 'release' as const,
        releaseTime: '',
      }))
  }

  async download(type: ServerType, version: string): Promise<string> {
    const jarDir = path.join(config.paths.jars, type)
    const jarPath = path.join(jarDir, `${version}.jar`)

    // Check cache
    if (fs.existsSync(jarPath)) {
      return jarPath
    }

    // Ensure directory exists
    fs.mkdirSync(jarDir, { recursive: true })

    const downloadUrl =
      type === 'vanilla' ? await this.getVanillaDownloadUrl(version) : await this.getPaperDownloadUrl(version)

    // Download JAR
    const response = await fetch(downloadUrl, this.fetchOptions)
    if (!response.ok) {
      throw new Error(`Failed to download JAR: ${response.status} ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    fs.writeFileSync(jarPath, Buffer.from(buffer))

    return jarPath
  }

  private async getVanillaDownloadUrl(version: string): Promise<string> {
    // Get manifest
    const manifestResponse = await fetch(this.vanillaManifestUrl, this.fetchOptions)
    const manifest = (await manifestResponse.json()) as VanillaManifest

    const versionInfo = manifest.versions.find((v) => v.id === version)
    if (!versionInfo) {
      throw new Error(`Version ${version} not found`)
    }

    // Get version data
    const versionResponse = await fetch(versionInfo.url, this.fetchOptions)
    const versionData = (await versionResponse.json()) as VanillaVersionData

    return versionData.downloads.server.url
  }

  private async getPaperDownloadUrl(version: string): Promise<string> {
    // Get builds for version
    const buildsUrl = `${this.paperApiUrl}/projects/paper/versions/${version}/builds`
    const buildsResponse = await fetch(buildsUrl, this.fetchOptions)
    if (!buildsResponse.ok) {
      throw new Error(`Version ${version} not found for Paper (${buildsResponse.status})`)
    }

    const buildsData = (await buildsResponse.json()) as PaperBuilds
    if (!buildsData.builds || buildsData.builds.length === 0) {
      throw new Error(`No builds found for Paper version ${version}`)
    }
    const latestBuild = buildsData.builds[buildsData.builds.length - 1].build

    // Get build info
    const buildUrl = `${this.paperApiUrl}/projects/paper/versions/${version}/builds/${latestBuild}`
    const buildResponse = await fetch(buildUrl, this.fetchOptions)
    if (!buildResponse.ok) {
      throw new Error(`Build ${latestBuild} not found for Paper ${version} (${buildResponse.status})`)
    }

    const buildData = (await buildResponse.json()) as PaperBuildInfo
    if (!buildData.downloads?.application?.name) {
      throw new Error(`No download found for Paper ${version} build ${latestBuild}`)
    }

    const jarName = buildData.downloads.application.name
    return `${this.paperApiUrl}/projects/paper/versions/${version}/builds/${latestBuild}/downloads/${jarName}`
  }

  getLocalPath(type: ServerType, version: string): string | null {
    const jarPath = path.join(config.paths.jars, type, `${version}.jar`)
    return fs.existsSync(jarPath) ? jarPath : null
  }
}

export const jarManager = new JarManager()
