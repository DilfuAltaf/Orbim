import type { IncomingMessage, ServerResponse } from 'node:http'
import { getSpotifyServerCredentials } from '../../src/server/spotify-service.ts'
import { sendJson } from '../../src/server/supabase-server.ts'

export default function handler(_req: IncomingMessage, res: ServerResponse): void {
  const { clientId, clientSecret } = getSpotifyServerCredentials()
  sendJson(res, 200, {
    ok: true,
    configured: Boolean(clientId && clientSecret),
  })
}
