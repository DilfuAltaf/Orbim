import crypto from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { saveServerAudioRecord } from '../../src/server/audio-registry-service.ts'
import {
  createServerSupabaseClient,
  extractBearerToken,
  readRawBody,
  sendError,
  sendJson,
  verifySupabaseToken,
} from '../../src/server/supabase-server.ts'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendError(res, 405, 'Method not allowed')
    return
  }

  try {
    const token = extractBearerToken(req)
    if (token) {
      const user = await verifySupabaseToken(token)
      if (user && user.email !== 'dilfualtaf07@gmail.com') {
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
