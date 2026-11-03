import type { IncomingMessage, ServerResponse } from 'node:http'
import { acceptServerInvitation } from '../../src/server/user-invitation-service.ts'
import {
  extractBearerToken,
  parseJsonBody,
  sendError,
  sendJson,
  verifySupabaseToken,
} from '../../src/server/supabase-server.ts'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendError(res, 405, 'Method not allowed')
    return
  }

  try {
    const parsed = await parseJsonBody<{
      token?: string
      userId?: string
      displayName?: string
    }>(req)

    if (!parsed.token) {
      sendError(res, 400, 'Missing invitation token')
      return
    }

    const authToken = extractBearerToken(req)
    let effectiveUserId = parsed.userId || 'guest'
    if (authToken) {
      const verified = await verifySupabaseToken(authToken)
      if (verified) {
        effectiveUserId = verified.id
      }
    }

    const result = acceptServerInvitation({
      token: parsed.token,
      userId: effectiveUserId,
      displayName: parsed.displayName,
    })

    const statusCode = result.success
      ? 200
      : result.errorKind === 'wrong_account'
        ? 403
        : result.errorKind === 'expired' ||
            result.errorKind === 'revoked' ||
            result.errorKind === 'declined' ||
            result.errorKind === 'already_accepted'
          ? 410
          : 400

    sendJson(res, statusCode, result)
  } catch {
    sendError(res, 400, 'Invalid JSON')
  }
}
