import type { IncomingMessage, ServerResponse } from 'node:http'
import { searchSpotifyTracksServer } from '../../src/server/spotify-service.ts'
import { sendError, sendJson } from '../../src/server/supabase-server.ts'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1:5173')
  const q = parsedUrl.searchParams.get('q') || ''
  const limitRaw = parsedUrl.searchParams.get('limit')
  const limit = limitRaw ? parseInt(limitRaw, 10) : 10
  const offsetRaw = parsedUrl.searchParams.get('offset')
  const offset = offsetRaw ? parseInt(offsetRaw, 10) : 0

  if (!q.trim()) {
    sendJson(res, 200, { tracks: [] })
    return
  }

  try {
    const tracks = await searchSpotifyTracksServer(q, { limit, offset })
    sendJson(res, 200, { tracks })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const isRateLimit = message.toLowerCase().includes('rate limit')
    const statusCode = isRateLimit ? 429 : 500

    sendError(
      res,
      statusCode,
      isRateLimit
        ? 'Spotify rate limit exceeded. Please wait a moment.'
        : 'Failed to search Spotify metadata on server.',
      { detail: message },
    )
  }
}
