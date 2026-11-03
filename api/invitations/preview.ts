import type { IncomingMessage, ServerResponse } from 'node:http'
import { getServerInvitationPreview } from '../../src/server/user-invitation-service.ts'
import {
  extractBearerToken,
  sendJson,
  verifySupabaseToken,
} from '../../src/server/supabase-server.ts'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1:5173')
  const tokenParam = parsedUrl.searchParams.get('token') || ''

  const authToken = extractBearerToken(req)
  let verifiedUserId: string | undefined
  if (authToken) {
    const verified = await verifySupabaseToken(authToken)
    if (verified) {
      verifiedUserId = verified.id
    }
  }

  const queryUserId = verifiedUserId || parsedUrl.searchParams.get('userId') || undefined
  const result = getServerInvitationPreview(tokenParam, queryUserId)

  sendJson(res, 200, { success: result.found, ...result })
}
