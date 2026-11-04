import type { IncomingMessage, ServerResponse } from 'node:http'

import { audioRegistryHandler } from '../../src/server/api-handlers/audio-handlers.ts'
import {
  spotifyHealthHandler,
  spotifyLyricsHandler,
  spotifySearchHandler,
} from '../../src/server/api-handlers/spotify-handlers.ts'
import { sendError } from '../../src/server/supabase-server.ts'

/**
 * Single Vercel Function for the whole /api/spotify namespace.
 *
 * URLs are unchanged:
 *   /api/spotify/health
 *   /api/spotify/search
 *   /api/spotify/lyrics
 *   /api/spotify/audio-registry   (alias of /api/audio/registry)
 */
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const { pathname } = new URL(req.url || '/', 'http://127.0.0.1:5173')
  const action = pathname.replace(/^\/api\/spotify\/?/, '').replace(/\/+$/, '')

  switch (action) {
    case 'health':
      spotifyHealthHandler(req, res)
      return
    case 'search':
      await spotifySearchHandler(req, res)
      return
    case 'lyrics':
      await spotifyLyricsHandler(req, res)
      return
    case 'audio-registry':
      await audioRegistryHandler(req, res)
      return
    default:
      sendError(res, 404, 'Spotify endpoint not found')
  }
}
