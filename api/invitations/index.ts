import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  createServerInvitation,
  listServerInvitationsForPlaylist,
  listServerInvitationsForUser,
} from '../../src/server/user-invitation-service.ts'
import {
  extractBearerToken,
  parseJsonBody,
  sendError,
  sendJson,
  verifySupabaseToken,
} from '../../src/server/supabase-server.ts'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1:5173')

  // POST: Create invitation
  if (req.method === 'POST') {
    try {
      const parsed = await parseJsonBody<{
        playlistId?: string
        createdBy?: string
        inviteeId?: string | null
        inviteeDisplayName?: string | null
        rawToken?: string
        tokenHash?: string
        role?: string
        expiresAt?: string
        playlistTitle?: string
      }>(req)

      const token = extractBearerToken(req)
      let effectiveCreator = parsed.createdBy || ''
      if (token) {
        const verified = await verifySupabaseToken(token)
        if (verified) {
          effectiveCreator = verified.id
        }
      }

      const result = createServerInvitation({
        playlistId: parsed.playlistId || '',
        createdBy: effectiveCreator,
        inviteeId: parsed.inviteeId || null,
        inviteeDisplayName: parsed.inviteeDisplayName || null,
        rawToken: parsed.rawToken,
        tokenHash: parsed.tokenHash,
        role: parsed.role,
        expiresAt: parsed.expiresAt,
        playlistTitle: parsed.playlistTitle,
      })

      const statusCode = result.success
        ? 200
        : result.errorKind === 'unauthorized'
          ? 403
          : result.errorKind === 'already_member'
            ? 409
            : 400

      sendJson(res, statusCode, result)
    } catch {
      sendError(res, 400, 'Invalid JSON')
    }
    return
  }

  // GET: List invitations for playlist or user inbox
  const playlistId = parsedUrl.searchParams.get('playlistId')
  const token = extractBearerToken(req)
  let verifiedUserId: string | undefined

  if (token) {
    const verified = await verifySupabaseToken(token)
    if (verified) {
      verifiedUserId = verified.id
    }
  }

  const queryUserId = verifiedUserId || parsedUrl.searchParams.get('userId') || undefined

  if (playlistId) {
    const result = listServerInvitationsForPlaylist(playlistId, queryUserId)
    const statusCode = result.error ? 403 : 200
    sendJson(res, statusCode, { success: !result.error, ...result })
    return
  }

  const invitations = listServerInvitationsForUser({
    userId: queryUserId,
    email: parsedUrl.searchParams.get('email') || undefined,
    displayName: parsedUrl.searchParams.get('displayName') || undefined,
  })

  sendJson(res, 200, { success: true, invitations })
}
