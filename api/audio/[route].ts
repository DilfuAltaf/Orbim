import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  audioRegistryHandler,
  audioStreamHandler,
  audioUploadHandler,
} from '../../src/server/api-handlers/audio-handlers.ts'
import { sendError } from '../../src/server/supabase-server.ts'

/**
 * Single Vercel Function for the whole /api/audio namespace.
 *
 * URLs are unchanged:
 *   /api/audio/registry
 *   /api/audio/stream        (also the target of the /assets/audio/* rewrite)
 *   /api/audio/upload
 */
export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1:5173')
  const rawQuery = (req as any).query?.route || parsedUrl.searchParams.get('route')
  const queryRoute = Array.isArray(rawQuery) ? rawQuery[0] : rawQuery
  const action = (typeof queryRoute === 'string' && queryRoute.trim() && queryRoute.trim() !== '[route]')
    ? queryRoute.trim().toLowerCase()
    : parsedUrl.pathname.replace(/^\/api\/audio\/?/i, '').replace(/\/+$/, '').toLowerCase()

  switch (action) {
    case 'registry':
      await audioRegistryHandler(req, res)
      return
    case 'stream':
      audioStreamHandler(req, res)
      return
    case 'upload':
      await audioUploadHandler(req, res)
      return
    default:
      sendError(res, 404, 'Audio endpoint not found')
  }
}
