import type { IncomingMessage, ServerResponse } from 'node:http'
import { fetchSpotifyTrackLyricsServer } from '../../src/server/spotify-service.ts'
import { sendError, sendJson } from '../../src/server/supabase-server.ts'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
