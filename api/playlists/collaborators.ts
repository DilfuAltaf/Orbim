import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  addPlaylistCollaborator,
  loadPlaylistCollaborators,
  removePlaylistCollaborator,
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
