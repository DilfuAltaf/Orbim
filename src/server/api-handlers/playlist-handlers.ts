import type { IncomingMessage, ServerResponse } from 'node:http'

import { isUserAdmin } from '../../features/auth/admin.ts'
import {
  addPlaylistCollaborator,
  deleteServerPlaylist,
  deleteServerPlaylistTrack,
  getFullServerPlaylist,
  getUserServerPlaylists,
  loadPlaylistCollaborators,
  loadServerPlaylists,
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
  type User,
} from '../supabase-server.ts'

/** GET/POST/DELETE /api/playlists */
export async function playlistsIndexHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1:5173')
  const authToken = extractBearerToken(req)
  let verifiedUser: User | null = null
  if (authToken) {
    verifiedUser = await verifySupabaseToken(authToken)
  }
  const verifiedUserId = verifiedUser?.id

  // DELETE
  if (req.method === 'DELETE') {
    try {
      if (!authToken) {
        sendError(res, 401, 'Authentication required to delete playlist')
        return
      }
      if (!verifiedUser || !verifiedUserId) {
        sendError(res, 401, 'Invalid or expired authentication token')
        return
      }

      const parsed = await parseJsonBody<{ playlistId?: string }>(req).catch(() => ({ playlistId: undefined }))
      const pid = parsedUrl.searchParams.get('playlistId') || parsed.playlistId
      if (pid) {
        const playlist = loadServerPlaylists().find((p) => p.id === pid)
        if (playlist) {
          const isOwner = playlist.owner_id === verifiedUserId
          const isAdmin = isUserAdmin(verifiedUser.email)
          if (!isOwner && !isAdmin) {
            sendError(res, 403, 'Unauthorized: only the playlist owner or admin can delete a playlist')
            return
          }
        }
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
  const authToken = extractBearerToken(req)
  let verifiedUser: User | null = null
  if (authToken) {
    verifiedUser = await verifySupabaseToken(authToken)
  }
  const verifiedUserId = verifiedUser?.id

  // DELETE
  if (req.method === 'DELETE') {
    try {
      const parsed = await parseJsonBody<{
        playlistId?: string
        trackId?: string
        providerTrackId?: string
      }>(req).catch(() => ({} as Record<string, string | undefined>))

      const pid = parsedUrl.searchParams.get('playlistId') || parsed.playlistId
      const tid =
        parsedUrl.searchParams.get('trackId') ||
        parsed.trackId ||
        parsedUrl.searchParams.get('providerTrackId') ||
        parsed.providerTrackId

      if (!pid || !tid) {
        sendError(res, 400, 'Missing playlistId or trackId parameter')
        return
      }

      if (!authToken) {
        sendError(res, 401, 'Authentication required to remove tracks')
        return
      }

      if (!verifiedUser || !verifiedUserId) {
        sendError(res, 401, 'Invalid or expired authentication token')
        return
      }

      const callerUserId = verifiedUserId
      const callerEmail = verifiedUser.email

      const playlist = loadServerPlaylists().find((p) => p.id === pid)
      if (!playlist) {
        sendError(res, 404, 'Playlist not found')
        return
      }

      const isOwner = playlist.owner_id === callerUserId
      const isAdmin = isUserAdmin(callerEmail)
      const collaborators = loadPlaylistCollaborators(pid)
      const member = collaborators.find((c) => c.userId === callerUserId)

      if (!isOwner && !isAdmin && !member) {
        sendError(res, 403, 'Unauthorized: you are not an active member of this playlist')
        return
      }

      if (member && member.role === 'viewer') {
        sendError(res, 403, 'Unauthorized: viewers cannot remove tracks')
        return
      }

      const tracks = loadServerPlaylistTracks(pid)
      const targetTrack = tracks.find((t) => t.id === tid || t.provider_track_id === tid)

      if (!isOwner && !isAdmin) {
        if (!member || member.role !== 'editor') {
          sendError(res, 403, 'Unauthorized: you do not have permission to remove tracks')
          return
        }

        if (targetTrack && targetTrack.added_by && targetTrack.added_by !== callerUserId) {
          sendError(res, 403, 'Unauthorized: editors can only remove tracks they added')
          return
        }
      }

      const exists = Boolean(targetTrack)
      const didRemove = deleteServerPlaylistTrack(pid, tid)
      sendJson(res, 200, {
        success: true,
        deleted: true,
        removed: didRemove,
        notFound: !exists,
      })
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
  const authToken = extractBearerToken(req)
  let verifiedUser: User | null = null
  if (authToken) {
    verifiedUser = await verifySupabaseToken(authToken)
  }
  const verifiedUserId = verifiedUser?.id

  // DELETE
  if (req.method === 'DELETE') {
    try {
      if (!authToken) {
        sendError(res, 401, 'Authentication required to remove collaborators')
        return
      }
      if (!verifiedUser || !verifiedUserId) {
        sendError(res, 401, 'Invalid or expired authentication token')
        return
      }

      const parsed = await parseJsonBody<{ playlistId?: string; userId?: string }>(req).catch(() => ({
        playlistId: undefined,
        userId: undefined,
      }))
      const playlistId = parsedUrl.searchParams.get('playlistId') || parsed.playlistId
      const targetUserId = parsedUrl.searchParams.get('userId') || parsed.userId
      if (!playlistId || !targetUserId) {
        sendError(res, 400, 'Missing playlistId or userId parameter')
        return
      }

      const playlist = loadServerPlaylists().find((p) => p.id === playlistId)
      if (!playlist) {
        sendError(res, 404, 'Playlist not found')
        return
      }

      const isOwner = playlist.owner_id === verifiedUserId
      const isAdmin = isUserAdmin(verifiedUser.email)
      const isSelf = targetUserId === verifiedUserId

      if (!isOwner && !isAdmin && !isSelf) {
        sendError(res, 403, 'Unauthorized: only playlist owners, admins, or the collaborator themselves can remove membership')
        return
      }

      removePlaylistCollaborator(playlistId, targetUserId)
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
