import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  deleteServerNotification,
  loadServerNotifications,
  saveServerNotification,
  updateNotificationStatus,
  type ServerNotificationRecord,
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
  const authToken = extractBearerToken(req)
  let verifiedUserId: string | undefined
  if (authToken) {
    const verified = await verifySupabaseToken(authToken)
    if (verified) {
      verifiedUserId = verified.id
    }
  }

  // DELETE
  if (req.method === 'DELETE') {
    try {
      const parsed = await parseJsonBody<{ id?: string }>(req).catch(() => ({ id: undefined }))
      const id = parsedUrl.searchParams.get('id') || parsed.id
      if (id) {
        deleteServerNotification(id)
      }
      sendJson(res, 200, { success: true, deleted: true })
    } catch {
      sendError(res, 400, 'Invalid JSON')
    }
    return
  }

  // PATCH
  if (req.method === 'PATCH') {
    try {
      const parsed = await parseJsonBody<{
        id?: string
        status?: 'accepted' | 'rejected'
        userId?: string
        displayName?: string
      }>(req)

      if (!parsed.id || !parsed.status) {
        sendError(res, 400, 'Missing id or status')
        return
      }

      const updated = updateNotificationStatus(
        parsed.id,
        parsed.status,
        verifiedUserId || parsed.userId,
        parsed.displayName,
      )

      sendJson(res, 200, { success: true, notification: updated })
    } catch {
      sendError(res, 400, 'Invalid JSON')
    }
    return
  }

  // POST
  if (req.method === 'POST') {
    try {
      const parsed = await parseJsonBody<ServerNotificationRecord>(req)
      if (!parsed.id) {
        parsed.id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      }
      if (!parsed.createdAt) {
        parsed.createdAt = new Date().toISOString()
      }
      if (!parsed.status) {
        parsed.status = 'pending'
      }
      if (verifiedUserId && !parsed.senderUserId) {
        parsed.senderUserId = verifiedUserId
      }

      saveServerNotification(parsed)
      sendJson(res, 200, { success: true, notification: parsed })
    } catch {
      sendError(res, 400, 'Invalid JSON')
    }
    return
  }

  // GET
  const queryUserId = verifiedUserId || parsedUrl.searchParams.get('userId') || undefined
  const email = parsedUrl.searchParams.get('email') || undefined
  const displayName = parsedUrl.searchParams.get('displayName') || undefined

  const notifications = loadServerNotifications({ userId: queryUserId, email, displayName })
  sendJson(res, 200, { success: true, notifications })
}
