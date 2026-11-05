import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  invitationAcceptHandler,
  invitationIndexHandler,
  invitationPreviewHandler,
  invitationRespondHandler,
} from '../../src/server/api-handlers/invitation-handlers.ts'
import { sendError } from '../../src/server/supabase-server.ts'

/**
 * Single Vercel Function for the whole /api/invitations namespace.
 *
 * `/api/invitations` itself is served by `api/invitations/index.ts`;
 * this single-segment dynamic route (api/invitations/[route].ts) handles:
 *   /api/invitations/preview
 *   /api/invitations/accept
 *   /api/invitations/respond
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
    : parsedUrl.pathname.replace(/^\/api\/invitations\/?/i, '').replace(/\/+$/, '').toLowerCase()

  switch (action) {
    case '':
      await invitationIndexHandler(req, res)
      return
    case 'preview':
      await invitationPreviewHandler(req, res)
      return
    case 'accept':
      await invitationAcceptHandler(req, res)
      return
    case 'respond':
      await invitationRespondHandler(req, res)
      return
    default:
      sendError(res, 404, 'Invitation endpoint not found')
  }
}
