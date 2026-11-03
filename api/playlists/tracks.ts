import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  deleteServerPlaylistTrack,
  loadServerPlaylistTracks,
  saveServerPlaylistTrack,
  type ServerPlaylistTrackRecord,
} from '../../src/server/user-invitation-service.ts'
import {
  parseJsonBody,
  sendError,
  sendJson,
} from '../../src/server/supabase-server.ts'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1:5173')

  // DELETE
  if (req.method === 'DELETE') {
    try {
      const parsed = await parseJsonBody<{ playlistId?: string; trackId?: string }>(req).catch(() => ({
        playlistId: undefined,
        trackId: undefined,
      }))
      const pid = parsedUrl.searchParams.get('playlistId') || parsed.playlistId
      const tid = parsedUrl.searchParams.get('trackId') || parsed.trackId
      if (pid && tid) {
        deleteServerPlaylistTrack(pid, tid)
      }
      sendJson(res, 200, { success: true, deleted: true })
    } catch {
      sendError(res, 400, 'Invalid JSON')
    }
    return
  }

  // POST
  if (req.method === 'POST') {
    try {
      const parsed = await parseJsonBody<{
        track?: ServerPlaylistTrackRecord
        tracks?: ServerPlaylistTrackRecord[]
        id?: string
        playlist_id?: string
        [key: string]: unknown
      }>(req)

      if (parsed.track) {
        saveServerPlaylistTrack(parsed.track)
      } else if (Array.isArray(parsed.tracks)) {
        for (const tr of parsed.tracks) {
          saveServerPlaylistTrack(tr)
        }
      } else if (parsed.id && parsed.playlist_id) {
        saveServerPlaylistTrack(parsed as unknown as ServerPlaylistTrackRecord)
      }

      sendJson(res, 200, { success: true })
    } catch {
      sendError(res, 400, 'Invalid JSON')
    }
    return
  }

  // GET
  const playlistId = parsedUrl.searchParams.get('playlistId') || undefined
  const tracks = loadServerPlaylistTracks(playlistId)
  sendJson(res, 200, { success: true, tracks })
}
