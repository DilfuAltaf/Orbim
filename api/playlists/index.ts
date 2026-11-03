import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  deleteServerPlaylist,
  getFullServerPlaylist,
  getUserServerPlaylists,
  saveServerPlaylist,
  saveServerPlaylistTrack,
  type ServerPlaylistRecord,
  type ServerPlaylistTrackRecord,
} from '../../src/server/user-invitation-service.ts'
import {
  extractBearerToken,
  parseJsonBody,
  sendError,
  sendJson,
  verifySupabaseToken,
} from '../../src/server/supabase-server.ts'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1:5173')
  const authToken = extractBearerToken(req)
  let verifiedUserId: string | undefined
  if (authToken) {
    const verified = await verifySupabaseToken(authToken)
    if (verified) {
      verifiedUserId = verified.id
    }
  }

  // DELETE
  if (req.method === 'DELETE') {
    try {
      const parsed = await parseJsonBody<{ playlistId?: string }>(req).catch(() => ({ playlistId: undefined }))
      const pid = parsedUrl.searchParams.get('playlistId') || parsed.playlistId
      if (pid) {
        deleteServerPlaylist(pid)
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
        playlist?: ServerPlaylistRecord
        tracks?: ServerPlaylistTrackRecord[]
        id?: string
        title?: string
        description?: string | null
        owner_id?: string
        visibility?: string
        created_at?: string
        updated_at?: string
      }>(req)

      const effectiveOwnerId = verifiedUserId || parsed.playlist?.owner_id || parsed.owner_id || 'system'

      const pl: ServerPlaylistRecord | null =
        parsed.playlist ||
        (parsed.id && parsed.title
          ? {
              id: parsed.id,
              title: parsed.title,
              description: parsed.description ?? null,
              owner_id: effectiveOwnerId,
              visibility: (parsed.visibility === 'shared' ? 'shared' : 'private') as 'private' | 'shared',
              created_at: parsed.created_at || new Date().toISOString(),
              updated_at: parsed.updated_at || new Date().toISOString(),
            }
          : null)

      if (pl) {
        if (verifiedUserId) {
          pl.owner_id = verifiedUserId
        }
        saveServerPlaylist(pl)
        if (Array.isArray(parsed.tracks)) {
          for (const tr of parsed.tracks) {
            saveServerPlaylistTrack(tr)
          }
        }
      }

      sendJson(res, 200, { success: true, playlist: pl })
    } catch {
      sendError(res, 400, 'Invalid JSON')
    }
    return
  }

  // GET
  const playlistId = parsedUrl.searchParams.get('playlistId')
  if (playlistId) {
    const full = getFullServerPlaylist(playlistId)
    if (!full) {
      sendError(res, 404, 'Playlist not found', { data: null })
    } else {
      sendJson(res, 200, { success: true, data: full })
    }
    return
  }

  const queryUserId = verifiedUserId || parsedUrl.searchParams.get('userId') || undefined
  const email = parsedUrl.searchParams.get('email') || undefined
  const displayName = parsedUrl.searchParams.get('displayName') || undefined

  const playlists = getUserServerPlaylists({ userId: queryUserId, email, displayName })
  sendJson(res, 200, { success: true, playlists })
}
