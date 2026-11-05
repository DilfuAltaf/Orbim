import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  acceptServerInvitation,
  createServerInvitation,
  getServerInvitationPreview,
  listServerInvitationsForPlaylist,
  listServerInvitationsForUser,
  respondToServerInvitation,
} from '../user-invitation-service.ts'
import {
  extractBearerToken,
  parseJsonBody,
  sendError,
  sendJson,
  verifySupabaseToken,
} from '../supabase-server.ts'

/** GET/POST /api/invitations */
export async function invitationIndexHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
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

      const result = await createServerInvitation({
        playlistId: parsed.playlistId || '',
        createdBy: effectiveCreator,
        inviteeId: parsed.inviteeId || null,
        inviteeDisplayName: parsed.inviteeDisplayName || null,
        rawToken: parsed.rawToken,
        tokenHash: parsed.tokenHash,
        role: parsed.role,
        expiresAt: parsed.expiresAt,
        playlistTitle: parsed.playlistTitle,
        bearerToken: token,
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
    const result = await listServerInvitationsForPlaylist(playlistId, queryUserId, token)
    const statusCode = result.error ? 403 : 200
    sendJson(res, statusCode, { success: !result.error, ...result })
    return
  }

  const invitations = await listServerInvitationsForUser({
    userId: queryUserId,
    email: parsedUrl.searchParams.get('email') || undefined,
    displayName: parsedUrl.searchParams.get('displayName') || undefined,
  }, token)

  sendJson(res, 200, { success: true, invitations })
}

/** GET /api/invitations/preview?token=... */
export async function invitationPreviewHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
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
  const result = await getServerInvitationPreview(tokenParam, queryUserId, authToken)

  sendJson(res, 200, { success: result.found, ...result })
}

/** POST /api/invitations/accept */
export async function invitationAcceptHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
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

    const result = await acceptServerInvitation({
      token: parsed.token,
      userId: effectiveUserId,
      displayName: parsed.displayName,
      bearerToken: authToken,
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

/** POST /api/invitations/respond */
export async function invitationRespondHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
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

    const result = await respondToServerInvitation({
      invitationId: parsed.invitationId,
      userId: effectiveUserId,
      displayName: parsed.displayName,
      action: parsed.action,
      bearerToken: authToken,
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
