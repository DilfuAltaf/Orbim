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
  const { pathname } = new URL(req.url || '/', 'http://127.0.0.1:5173')
  const action = pathname.replace(/^\/api\/audio\/?/, '').replace(/\/+$/, '')

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
