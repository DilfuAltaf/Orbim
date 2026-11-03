import type { IncomingMessage, ServerResponse } from 'node:http'
import { respondToServerInvitation } from '../../src/server/user-invitation-service.ts'
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
      invitationId?: string
      userId?: string
      displayName?: string
      action?: 'accept' | 'decline'
    }>(req)

    if (!parsed.invitationId || !parsed.action || (parsed.action !== 'accept' && parsed.action !== 'decline')) {
      sendJson(res, 400, { success: false, errorKind: 'invalid', error: 'Missing invitationId or action' })
      return
    }

    const authToken = extractBearerToken(req)
    let effectiveUserId = parsed.userId || ''
    if (authToken) {
      const verified = await verifySupabaseToken(authToken)
      if (verified) {
        effectiveUserId = verified.id
      }
    }

    const result = respondToServerInvitation({
      invitationId: parsed.invitationId,
      userId: effectiveUserId,
      displayName: parsed.displayName,
      action: parsed.action,
    })

    const statusCode = result.success
      ? 200
      : result.errorKind === 'unauthorized'
        ? 403
        : result.errorKind === 'expired' || result.errorKind === 'revoked' || result.errorKind === 'declined'
          ? 410
          : 400

    sendJson(res, statusCode, result)
  } catch {
    sendJson(res, 400, { success: false, errorKind: 'invalid', error: 'Invalid JSON' })
  }
}
