import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  fetchSpotifyTrackLyricsServer,
  getSpotifyServerCredentials,
  searchSpotifyTracksServer,
} from '../spotify-service.ts'
import { sendError, sendJson } from '../supabase-server.ts'

/** GET /api/spotify/health */
export function spotifyHealthHandler(_req: IncomingMessage, res: ServerResponse): void {
  const { clientId, clientSecret } = getSpotifyServerCredentials()
  sendJson(res, 200, {
    ok: true,
    configured: Boolean(clientId && clientSecret),
  })
}

/** GET /api/spotify/search?q=...&limit=...&offset=... */
export async function spotifySearchHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
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

/** GET /api/spotify/lyrics?title=...&artist=... */
export async function spotifyLyricsHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1:5173')
  const qTitle = parsedUrl.searchParams.get('title') || ''
  const qArtist = parsedUrl.searchParams.get('artist') || ''

  if (!qTitle.trim() || !qArtist.trim()) {
    sendError(res, 400, 'Missing title or artist parameter')
    return
  }

  try {
    const result = await fetchSpotifyTrackLyricsServer(qTitle, qArtist)
    sendJson(res, 200, result, {
      'Cache-Control': 'public, max-age=3600',
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    sendError(res, 404, 'Lyrics not found', { detail: message })
  }
}
