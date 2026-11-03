import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  deleteServerAudioRecord,
  loadServerAudioRegistry,
  saveServerAudioRecord,
  type ServerAudioRecord,
} from '../../src/server/audio-registry-service.ts'
import {
  createServerSupabaseClient,
  parseJsonBody,
  sendError,
  sendJson,
} from '../../src/server/supabase-server.ts'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1:5173')

  // DELETE
  if (req.method === 'DELETE') {
    const queryTrackId = parsedUrl.searchParams.get('providerTrackId')
    if (queryTrackId) {
      deleteServerAudioRecord(queryTrackId)
      sendJson(res, 200, { success: true, deleted: true })
      return
    }

    try {
      const parsed = await parseJsonBody<{ providerTrackId?: string }>(req)
      if (parsed.providerTrackId) {
        deleteServerAudioRecord(parsed.providerTrackId)
      }
      sendJson(res, 200, { success: true, deleted: true })
    } catch {
      sendError(res, 400, 'Invalid JSON payload')
    }
    return
  }

  // POST
  if (req.method === 'POST') {
    try {
      const parsed = await parseJsonBody<{
        action?: string
        delete?: boolean
        record?: ServerAudioRecord
        records?: Record<string, ServerAudioRecord>
        providerTrackId?: string
        audioUrl?: string
        storagePath?: string
        title?: string
        artistName?: string
      }>(req)

      if (parsed.delete || parsed.action === 'delete') {
        if (parsed.providerTrackId) {
          deleteServerAudioRecord(parsed.providerTrackId)
        }
        sendJson(res, 200, { success: true, deleted: true })
        return
      }

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
