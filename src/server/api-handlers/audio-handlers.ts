import crypto from 'node:crypto'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'

import { isUserAdmin } from '../../features/auth/admin.ts'
import {
  loadServerAudioRegistry,
  saveServerAudioRecord,
  type ServerAudioRecord,
} from '../audio-registry-service.ts'
import {
  createServerSupabaseClient,
  extractBearerToken,
  parseJsonBody,
  readRawBody,
  sendError,
  sendJson,
  verifySupabaseToken,
} from '../supabase-server.ts'

/**
 * GET/POST /api/audio/registry
 * Server-side audio registry reads/writes, enriched from published `catalog_tracks`.
 */
export async function audioRegistryHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // POST
  if (req.method === 'POST') {
    try {
      const parsed = await parseJsonBody<{
        record?: ServerAudioRecord
        records?: Record<string, ServerAudioRecord>
        providerTrackId?: string
        audioUrl?: string
        storagePath?: string
        title?: string
        artistName?: string
      }>(req)

      if (parsed.record) {
        saveServerAudioRecord(parsed.record)
      } else if (parsed.records) {
        for (const r of Object.values(parsed.records)) {
          saveServerAudioRecord(r)
        }
      } else if (parsed.providerTrackId && parsed.audioUrl) {
        saveServerAudioRecord({
          providerTrackId: parsed.providerTrackId,
          audioUrl: parsed.audioUrl,
          audioSourceType: parsed.audioUrl.startsWith('http') ? 'storage' : 'direct_stream',
          storagePath: parsed.storagePath,
          title: parsed.title,
          artistName: parsed.artistName,
          updatedAt: new Date().toISOString(),
        })
      }

      sendJson(res, 200, { success: true })
    } catch {
      sendError(res, 400, 'Invalid JSON payload')
    }
    return
  }

  // GET
  const records = { ...loadServerAudioRegistry(false) }

  // Enrich from Supabase catalog_tracks if accessible
  try {
    const supabase = createServerSupabaseClient()
    if (supabase) {
      const { data } = await supabase
        .from('catalog_tracks')
        .select('provider_track_id, title, artist_name, storage_path, audio_url, audio_source_type, publication_status')
        .eq('publication_status', 'published')

      if (data && Array.isArray(data)) {
        for (const row of data) {
          if (row.provider_track_id && (row.audio_url || row.storage_path)) {
            const url =
              row.audio_url ||
              `https://rprrvdyugakkpittzvjv.supabase.co/storage/v1/object/public/track-audio/${row.storage_path}`
            const rec: ServerAudioRecord = {
              providerTrackId: row.provider_track_id,
              audioUrl: url,
              storagePath: row.storage_path || undefined,
              audioSourceType: 'storage',
              title: row.title,
              artistName: row.artist_name,
              updatedAt: new Date().toISOString(),
            }
            records[row.provider_track_id] = rec
            records[`spotify:track:${row.provider_track_id}`] = rec
          }
        }
      }
    }
  } catch {
    // Non-blocking
  }

  sendJson(res, 200, { success: true, records, ...records })
}

/**
 * GET /api/audio/stream?path=... (also reached via the /assets/audio/* rewrite)
 * Redirects known remote audio to its CDN URL, otherwise streams the local file.
 */
export function audioStreamHandler(req: IncomingMessage, res: ServerResponse): void {
  const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1:5173')
  const requestedPath = parsedUrl.searchParams.get('path') || parsedUrl.pathname.replace(/^\/assets\/audio\//, '')
  const decodedPath = decodeURIComponent(requestedPath).replace(/^\//, '')
  const absolutePath = path.resolve(process.cwd(), 'assets/audio', decodedPath)

  // Prevent directory traversal
  const baseAudioDir = path.resolve(process.cwd(), 'assets/audio')
  if (!absolutePath.startsWith(baseAudioDir)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  // 1. Check registry for remote CDN URL
  const registry = loadServerAudioRegistry(false)
  const reqBase = path.basename(decodedPath)

  for (const rec of Object.values(registry)) {
    if (rec.audioUrl && rec.audioUrl.startsWith('http')) {
      const recBase = rec.storagePath ? path.basename(rec.storagePath) : path.basename(rec.audioUrl)
      if (recBase === reqBase) {
        res.writeHead(307, {
          Location: rec.audioUrl,
          'Cache-Control': 'public, max-age=3600',
        })
        res.end()
        return
      }
    }
  }

  // Fallback to Supabase Storage direct URL for global tracks
  if (decodedPath.startsWith('global/')) {
    const remoteUrl = `https://rprrvdyugakkpittzvjv.supabase.co/storage/v1/object/public/track-audio/${decodedPath}`
    res.writeHead(307, {
      Location: remoteUrl,
      'Cache-Control': 'public, max-age=3600',
    })
    res.end()
    return
  }

  // 2. If file exists locally on disk
  if (!fs.existsSync(absolutePath)) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Audio file not found' }))
    return
  }

  const stat = fs.statSync(absolutePath)
  const range = req.headers.range

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1
    const chunkSize = end - start + 1

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'audio/mpeg',
    })
    fs.createReadStream(absolutePath, { start, end }).pipe(res)
  } else {
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Content-Type': 'audio/mpeg',
    })
    fs.createReadStream(absolutePath).pipe(res)
  }
}

/**
 * POST /api/audio/upload
 * Admin-only audio upload to Supabase Storage plus catalog_tracks sync.
 */
export async function audioUploadHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    sendError(res, 405, 'Method not allowed')
    return
  }

  try {
    const token = extractBearerToken(req)
    if (token) {
      const user = await verifySupabaseToken(token)
      if (user && !isUserAdmin(user.email)) {
        // Only admin can upload audio
        sendError(res, 403, 'Hanya akun administrator yang diizinkan mengunggah audio.')
        return
      }
    }

    const contentType = req.headers['content-type'] || 'application/octet-stream'
    const providerTrackId = (req.headers['x-provider-track-id'] as string) || ''
    const rawFileName = (req.headers['x-file-name'] as string) || 'track.mp3'
    let fileName = decodeURIComponent(rawFileName)
    const title = decodeURIComponent((req.headers['x-title'] as string) || '')
    const artistName = decodeURIComponent((req.headers['x-artist'] as string) || '')

    const rawBuffer = await readRawBody(req)
    let fileBuffer: Buffer

    if (contentType.includes('application/json')) {
      const json = JSON.parse(rawBuffer.toString('utf8')) as {
        providerTrackId?: string
        fileName?: string
        title?: string
        artistName?: string
        base64Data?: string
      }
      if (!json.base64Data) {
        sendError(res, 400, 'Missing base64Data')
        return
      }
      fileBuffer = Buffer.from(json.base64Data, 'base64')
      if (json.fileName) fileName = json.fileName
    } else {
      fileBuffer = rawBuffer
    }

    if (fileBuffer.length === 0) {
      sendError(res, 400, 'Empty file payload')
      return
    }

    const dotIdx = fileName.lastIndexOf('.')
    const ext = dotIdx !== -1 ? fileName.substring(dotIdx).toLowerCase() : '.mp3'
    const trackUuid = crypto.randomUUID()
    const relativeStoragePath = `global/${trackUuid}${ext}`

    let mimeType = 'audio/mpeg'
    if (ext === '.wav') mimeType = 'audio/wav'
    else if (ext === '.ogg') mimeType = 'audio/ogg'
    else if (ext === '.flac') mimeType = 'audio/flac'
    else if (ext === '.m4a') mimeType = 'audio/mp4'

    // Upload to Supabase Storage bucket 'track-audio'
    const supabase = createServerSupabaseClient()
    let audioUrl = `/assets/audio/${relativeStoragePath}`

    if (supabase) {
      const { error: uploadError } = await supabase.storage
        .from('track-audio')
        .upload(relativeStoragePath, fileBuffer, {
          contentType: mimeType,
          upsert: true,
        })

      if (!uploadError) {
        const { data: urlData } = supabase.storage
          .from('track-audio')
          .getPublicUrl(relativeStoragePath)
        if (urlData?.publicUrl) {
          audioUrl = urlData.publicUrl
        }
      }
    }

    if (providerTrackId) {
      saveServerAudioRecord({
        providerTrackId,
        audioUrl,
        storagePath: relativeStoragePath,
        audioSourceType: audioUrl.startsWith('http') ? 'storage' : 'direct_stream',
        title,
        artistName,
        updatedAt: new Date().toISOString(),
      })

      // If Supabase is available, sync to public.catalog_tracks
      if (supabase && audioUrl.startsWith('http')) {
        try {
          await supabase
            .from('catalog_tracks')
            .upsert(
              {
                provider: 'spotify',
                provider_track_id: providerTrackId.replace(/^spotify:track:/i, '').trim(),
                title: title || 'Track',
                artist_name: artistName || 'Unknown Artist',
                storage_path: relativeStoragePath,
                audio_url: audioUrl,
                audio_source_type: 'storage',
                publication_status: 'published',
                published_at: new Date().toISOString(),
              },
              { onConflict: 'provider,provider_track_id' },
            )
        } catch {
          // ignore sync errors
        }
      }
    }

    sendJson(res, 200, {
      success: true,
      audioUrl,
      storagePath: relativeStoragePath,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    sendError(res, 500, `Server failed to process audio upload: ${msg}`)
  }
}
