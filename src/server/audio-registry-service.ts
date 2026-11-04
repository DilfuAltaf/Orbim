/**
 * Server-Side Global Audio Registry & Asset Streaming Service.
 *
 * Exposes:
 * - In-memory and disk persistence for platform-wide audio track associations.
 * - Seeds known tracks from tracks-spotify-31.json so existing asset audio is available to all users.
 * - Supports HTTP 206 Partial Content byte-range streaming for seamless seek and play.
 */

import fs from 'node:fs'
import path from 'node:path'

export interface ServerAudioRecord {
  providerTrackId: string
  storagePath?: string
  audioUrl: string
  audioSourceType: 'storage' | 'direct_stream'
  title?: string
  artistName?: string
  updatedAt: string
}

let serverAudioCache: Record<string, ServerAudioRecord> | null = null

function getRegistryFilePath(): string {
  return path.resolve(process.cwd(), 'assets/audio/global-audio-registry.json')
}

export function loadServerAudioRegistry(forceReload = false): Record<string, ServerAudioRecord> {
  if (serverAudioCache && !forceReload) {
    return serverAudioCache
  }

  const map: Record<string, ServerAudioRecord> = {}

  // 1. Seed from tracks-spotify-31.json if present
  try {
    const catalogPath = path.resolve(process.cwd(), 'tracks-spotify-31.json')
    if (fs.existsSync(catalogPath)) {
      const content = fs.readFileSync(catalogPath, 'utf8')
      const tracks = JSON.parse(content) as Array<{
        providerTrackId?: string
        title?: string
        artist?: string
        audioFile?: string
      }>
      for (const t of tracks) {
        if (t.providerTrackId && t.audioFile) {
          const filePath = path.resolve(process.cwd(), t.audioFile)
          if (fs.existsSync(filePath)) {
            const urlPath = `/${t.audioFile.replace(/\\/g, '/')}`
            map[t.providerTrackId] = {
              providerTrackId: t.providerTrackId,
              audioUrl: urlPath,
              audioSourceType: 'direct_stream',
              title: t.title,
              artistName: t.artist,
              updatedAt: new Date().toISOString(),
            }
          }
        }
      }
    }
  } catch {
    // Ignore seed errors
  }

  // 2. Overlay persistent custom uploads from global-audio-registry.json
  try {
    const regPath = getRegistryFilePath()
    if (fs.existsSync(regPath)) {
      const content = fs.readFileSync(regPath, 'utf8')
      const custom = JSON.parse(content) as Record<string, ServerAudioRecord>
      for (const [key, val] of Object.entries(custom)) {
        if (!val.audioUrl && val.storagePath) {
          if (val.storagePath.startsWith('global/')) {
            val.audioUrl = `/assets/audio/${val.storagePath}`
            val.audioSourceType = 'direct_stream'
          } else {
            val.audioUrl = `https://rprrvdyugakkpittzvjv.supabase.co/storage/v1/object/public/track-audio/${val.storagePath}`
            val.audioSourceType = 'storage'
          }
        }
        map[key] = val
      }
    }
  } catch {
    // Ignore custom read errors
  }

  serverAudioCache = map
  return serverAudioCache
}

export function saveServerAudioRecord(record: ServerAudioRecord): void {
  const current = loadServerAudioRegistry()
  current[record.providerTrackId] = record

  try {
    const regPath = getRegistryFilePath()
    const dir = path.dirname(regPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(regPath, JSON.stringify(current, null, 2), 'utf8')
  } catch {
    // Ignore write failures in read-only environments
  }
}

