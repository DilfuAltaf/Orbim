import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  addPlaylistCollaborator,
  deleteServerPlaylist,
  deleteServerPlaylistTrack,
  getFullServerPlaylist,
  getUserServerPlaylists,
  loadPlaylistCollaborators,
  loadServerPlaylistTracks,
  removePlaylistCollaborator,
  saveServerPlaylist,
  saveServerPlaylistTrack,
  type ServerPlaylistRecord,
  type ServerPlaylistTrackRecord,
} from '../user-invitation-service.ts'
import {
  extractBearerToken,
  parseJsonBody,
  sendError,
  sendJson,
  verifySupabaseToken,
} from '../supabase-server.ts'

/** GET/POST/DELETE /api/playlists */
export async function playlistsIndexHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
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

/** GET/POST/DELETE /api/playlists/tracks */
export async function playlistTracksHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
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

/** GET/POST/DELETE /api/playlists/collaborators */
export async function playlistCollaboratorsHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1:5173')

  // DELETE
  if (req.method === 'DELETE') {
    try {
      const parsed = await parseJsonBody<{ playlistId?: string; userId?: string }>(req).catch(() => ({
        playlistId: undefined,
        userId: undefined,
      }))
      const playlistId = parsedUrl.searchParams.get('playlistId') || parsed.playlistId
      const userId = parsedUrl.searchParams.get('userId') || parsed.userId
      if (playlistId && userId) {
        removePlaylistCollaborator(playlistId, userId)
      }
      sendJson(res, 200, { success: true, removed: true })
    } catch {
      sendError(res, 400, 'Invalid JSON')
    }
    return
  }

  // POST
  if (req.method === 'POST') {
    try {
      const parsed = await parseJsonBody<{
        playlistId: string
        userId: string
        displayName: string
        location?: string
        role?: string
      }>(req)

      if (!parsed.playlistId || !parsed.userId || !parsed.displayName) {
        sendError(res, 400, 'Missing playlistId, userId, or displayName')
        return
      }

      addPlaylistCollaborator(parsed)
      sendJson(res, 200, { success: true })
    } catch {
      sendError(res, 400, 'Invalid JSON')
    }
    return
  }

  // GET
  const playlistId = parsedUrl.searchParams.get('playlistId') || undefined
  const collaborators = loadPlaylistCollaborators(playlistId)
  sendJson(res, 200, { success: true, collaborators })
}
