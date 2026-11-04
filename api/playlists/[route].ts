import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  playlistCollaboratorsHandler,
  playlistTracksHandler,
  playlistsIndexHandler,
} from '../../src/server/api-handlers/playlist-handlers.ts'
import { sendError } from '../../src/server/supabase-server.ts'

/**
 * Single Vercel Function for the whole /api/playlists namespace.
 *
 * `/api/playlists` itself is served by `api/playlists/index.ts`;
 * this single-segment dynamic route (api/playlists/[route].ts) handles:
 *   /api/playlists/collaborators
 *   /api/playlists/tracks
 */
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const { pathname } = new URL(req.url || '/', 'http://127.0.0.1:5173')
  const action = pathname.replace(/^\/api\/playlists\/?/, '').replace(/\/+$/, '')

  switch (action) {
    case '':
      await playlistsIndexHandler(req, res)
      return
    case 'collaborators':
      await playlistCollaboratorsHandler(req, res)
      return
    case 'tracks':
      await playlistTracksHandler(req, res)
      return
    default:
      sendError(res, 404, 'Playlist endpoint not found')
  }
}
