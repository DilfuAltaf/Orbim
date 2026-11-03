import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadServerUsers, saveServerUser, type ServerUserRecord } from '../../src/server/user-invitation-service.ts'
import {
  createServerSupabaseClient,
  extractBearerToken,
  parseJsonBody,
  sendError,
  sendJson,
  verifySupabaseToken,
} from '../../src/server/supabase-server.ts'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1:5173')

  // POST: Create or update user
  if (req.method === 'POST') {
    try {
      const parsed = await parseJsonBody<{ user?: ServerUserRecord }>(req)
      if (parsed.user) {
        const token = extractBearerToken(req)
        if (token) {
          const verified = await verifySupabaseToken(token)
          if (verified && verified.id !== parsed.user.id) {
            sendError(res, 403, 'Unauthorized: Cannot modify other user profile')
            return
          }
        }
        saveServerUser(parsed.user)

        // Sync to Supabase profiles if possible
        const supabase = createServerSupabaseClient(token)
        if (supabase && parsed.user.id) {
          try {
            await supabase.from('profiles').upsert({
              id: parsed.user.id,
              display_name: parsed.user.displayName,
              avatar_url: parsed.user.avatarUrl || null,
              location: parsed.user.location || null,
              updated_at: new Date().toISOString(),
            })
          } catch {
            // ignore
          }
        }
      }
      sendJson(res, 200, { success: true })
    } catch {
      sendError(res, 400, 'Invalid JSON')
    }
    return
  }

  // GET: Public directory search
  const q = (parsedUrl.searchParams.get('q') || '').trim().toLowerCase()
  const userMap = new Map<string, { id: string; displayName: string; avatarUrl: string | null; location: string | null }>()

  // 1. Load from Supabase profiles
  try {
    const supabase = createServerSupabaseClient()
    if (supabase) {
      let query = supabase.from('profiles').select('id, display_name, avatar_url, location')
      if (q) {
        query = query.ilike('display_name', `%${q}%`)
      }
      const { data } = await query.limit(50)
      if (data && Array.isArray(data)) {
        for (const p of data) {
          if (p.id && p.display_name) {
            userMap.set(p.id, {
              id: p.id,
              displayName: p.display_name,
              avatarUrl: p.avatar_url ?? null,
              location: p.location ?? null,
            })
          }
        }
      }
    }
  } catch {
    // Non-blocking
  }

  // 2. Overlay server users
  for (const u of loadServerUsers()) {
    if (!q || u.displayName.toLowerCase().includes(q)) {
      if (!userMap.has(u.id)) {
        userMap.set(u.id, {
          id: u.id,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl ?? null,
          location: u.location ?? null,
        })
      }
    }
  }

  const users = Array.from(userMap.values())
  sendJson(res, 200, { success: true, users })
}
