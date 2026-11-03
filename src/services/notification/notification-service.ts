/**
 * Client-Side Notification Service for Collaborator Invites & Actions
 */

import { isSupabaseConfigured, supabase } from '@/lib/supabase'
import {
  acceptPlaylistInvitation,
  acceptInvitationById,
  declineInvitationById,
  createUsernamePlaylistInvitation,
  fetchServerFullPlaylist,
} from '@/services/playlist/supabase-playlist'
import {
  getActiveLocalUser,
  saveLocalPlaylist,
  saveLocalPlaylistTrack,
} from '@/services/auth/local-auth-store'
import type { UserCandidate } from '@/services/user/collaborator-search'

export interface AppNotification {
  id: string
  type: 'playlist_invitation' | 'playlist_removed'
  recipientUserId: string
  recipientDisplayName?: string
  recipientEmail?: string
  senderUserId: string
  senderDisplayName: string
  playlistId: string
  playlistTitle: string
  role: string
  status: 'pending' | 'accepted' | 'rejected' | 'removed'
  createdAt: string
  rawToken?: string
}

export type NotificationUserQuery =
  | string
  | {
      userId?: string | null
      email?: string | null
      displayName?: string | null
    }

const LOCAL_NOTIFICATIONS_KEY = 'orbim_user_notifications'

export function getLocalNotifications(): AppNotification[] {
  if (typeof window === 'undefined' || !window.localStorage) return []
  try {
    const raw = window.localStorage.getItem(LOCAL_NOTIFICATIONS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveLocalNotifications(notifications: AppNotification[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(LOCAL_NOTIFICATIONS_KEY, JSON.stringify(notifications))
  } catch {
    // Non-blocking
  }
}

export function dispatchNotificationsUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('orbim:notifications-updated'))
  }
}

/**
 * Fetches notifications for the active user from the server and local cache.
 */
export async function fetchUserNotifications(
  query?: NotificationUserQuery | null,
): Promise<AppNotification[]> {
  const activeLocal = getActiveLocalUser()
  const params = new URLSearchParams()
  const searchTokens: string[] = []

  if (typeof query === 'string') {
    const trimmed = query.trim()
    if (trimmed) {
      params.set('userId', trimmed)
      searchTokens.push(trimmed.toLowerCase())
    }
  } else if (query && typeof query === 'object') {
    if (query.userId?.trim()) {
      params.set('userId', query.userId.trim())
      searchTokens.push(query.userId.trim().toLowerCase())
    }
    if (query.email?.trim()) {
      params.set('email', query.email.trim())
      searchTokens.push(query.email.trim().toLowerCase())
    }
    if (query.displayName?.trim()) {
      params.set('displayName', query.displayName.trim())
      searchTokens.push(query.displayName.trim().toLowerCase())
    }
  }

  // Fallback to active local user if no tokens provided
  if (searchTokens.length === 0 && activeLocal) {
    if (activeLocal.id) {
      params.set('userId', activeLocal.id)
      searchTokens.push(activeLocal.id.toLowerCase())
    }
    if (activeLocal.email) {
      params.set('email', activeLocal.email)
      searchTokens.push(activeLocal.email.toLowerCase())
    }
    if (activeLocal.displayName) {
      params.set('displayName', activeLocal.displayName)
      searchTokens.push(activeLocal.displayName.toLowerCase())
    }
  }

  const map = new Map<string, AppNotification>()

  // 1. Fetch remote Supabase invitations if signed into Supabase
  try {
    const { data: authData } = await supabase.auth.getUser()
    if (authData?.user && isSupabaseConfigured()) {
      const { data: dbInvites, error: dbError } = await supabase
        .from('playlist_invitations')
        .select(`
          id,
          playlist_id,
          created_by,
          invitee_id,
          role,
          status,
          expires_at,
          created_at,
          responded_at,
          playlists (id, title),
          profiles:created_by (id, display_name, avatar_url)
        `)
        .eq('invitee_id', authData.user.id)
        .order('created_at', { ascending: false })

      if (!dbError && Array.isArray(dbInvites)) {
        for (const inv of dbInvites) {
          const inviterProfile = Array.isArray(inv.profiles)
            ? inv.profiles[0]
            : (inv.profiles as { display_name?: string } | null)
          const playlistRow = Array.isArray(inv.playlists)
            ? inv.playlists[0]
            : (inv.playlists as { title?: string } | null)

          map.set(inv.id, {
            id: inv.id,
            type: 'playlist_invitation',
            recipientUserId: inv.invitee_id || authData.user.id,
            senderUserId: inv.created_by,
            senderDisplayName: inviterProfile?.display_name || 'Pemilik Playlist',
            playlistId: inv.playlist_id,
            playlistTitle: playlistRow?.title || 'Playlist',
            role: inv.role || 'editor',
            status:
              inv.status === 'accepted'
                ? 'accepted'
                : inv.status === 'declined'
                  ? 'rejected'
                  : 'pending',
            createdAt: inv.created_at,
          })
        }
      }
    }
  } catch {
    // Non-blocking in offline / unconfigured environments
  }

  // 2. Query dev server notifications
  let serverList: AppNotification[] = []
  if (typeof fetch === 'function') {
    try {
      const q = params.toString() ? `?${params.toString()}` : ''
      const res = await fetch(`/api/notifications${q}`)
      if (res.ok) {
        const payload = (await res.json()) as {
          success?: boolean
          notifications?: AppNotification[]
        }
        if (payload?.success && Array.isArray(payload.notifications)) {
          serverList = payload.notifications
        }
      }
    } catch {
      // Non-blocking
    }
  }

  for (const n of serverList) {
    if (!map.has(n.id)) {
      map.set(n.id, n)
    }
  }

  // 3. Merge with local notifications
  const localList = getLocalNotifications()
  const tokenSet = new Set(searchTokens)
  for (const n of localList) {
    if (!map.has(n.id)) {
      if (tokenSet.size === 0) {
        map.set(n.id, n)
      } else {
        const match =
          (n.recipientUserId && tokenSet.has(n.recipientUserId.toLowerCase())) ||
          (n.recipientEmail && tokenSet.has(n.recipientEmail.toLowerCase())) ||
          (n.recipientDisplayName && tokenSet.has(n.recipientDisplayName.toLowerCase()))
        if (match) {
          map.set(n.id, n)
        }
      }
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

/**
 * Sends a playlist collaboration invitation notification to a target user.
 */
export async function sendPlaylistInvitationNotification(params: {
  recipientUser: UserCandidate
  playlistId: string
  playlistTitle: string
  senderUserId: string
  senderDisplayName: string
  rawToken?: string
}): Promise<{ data: AppNotification | null; error: Error | null }> {
  let dbInvitationId: string | undefined

  // 1. If authenticated in Supabase, persist real record in public.playlist_invitations
  const { data: authData } = await supabase.auth.getUser()
  if (authData?.user && isSupabaseConfigured()) {
    const { data: dbInvite, error: inviteError } = await createUsernamePlaylistInvitation(
      params.playlistId,
      params.recipientUser.id,
      params.playlistTitle,
    )
    if (inviteError) {
      return { data: null, error: inviteError }
    }
    if (dbInvite) {
      dbInvitationId = dbInvite.id
    }
  }

  const notifId =
    dbInvitationId || `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

  const newNotif: AppNotification = {
    id: notifId,
    type: 'playlist_invitation',
    recipientUserId: params.recipientUser.id,
    recipientDisplayName: params.recipientUser.displayName,
    recipientEmail: params.recipientUser.email,
    senderUserId: params.senderUserId,
    senderDisplayName: params.senderDisplayName || 'Playlist Owner',
    playlistId: params.playlistId,
    playlistTitle: params.playlistTitle,
    role: 'editor',
    status: 'pending',
    createdAt: new Date().toISOString(),
    rawToken: params.rawToken,
  }

  // 2. Post to dev server for local fallback
  try {
    if (typeof fetch === 'function') {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newNotif),
      }).catch(() => null)
    }
  } catch {
    // Non-blocking
  }

  // 3. Cache in local notifications
  const current = getLocalNotifications()
  current.unshift(newNotif)
  saveLocalNotifications(current)
  dispatchNotificationsUpdated()

  return { data: newNotif, error: null }
}

/**
 * Notifies a collaborator that the owner removed them from a playlist, so the
 * kick does not happen silently for the other account.
 */
export async function sendPlaylistRemovalNotification(params: {
  recipientUserId: string
  recipientDisplayName?: string
  playlistId: string
  playlistTitle: string
  senderUserId: string
  senderDisplayName: string
}): Promise<{ data: AppNotification | null; error: Error | null }> {
  const newNotif: AppNotification = {
    id: `notif-removal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'playlist_removed',
    recipientUserId: params.recipientUserId,
    recipientDisplayName: params.recipientDisplayName,
    senderUserId: params.senderUserId,
    senderDisplayName: params.senderDisplayName || 'Pemilik Playlist',
    playlistId: params.playlistId,
    playlistTitle: params.playlistTitle,
    role: 'editor',
    status: 'removed',
    createdAt: new Date().toISOString(),
  }

  // Deliver through the dev server registry so the other account (different
  // browser profile or device) receives it through its notification polling.
  try {
    if (typeof fetch === 'function') {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newNotif),
      }).catch(() => null)
    }
  } catch {
    // Non-blocking
  }

  const current = getLocalNotifications()
  current.unshift(newNotif)
  saveLocalNotifications(current)
  dispatchNotificationsUpdated()

  return { data: newNotif, error: null }
}

/**
 * Accepts or rejects an invitation notification.
 */
export async function respondToInvitationNotification(
  notificationOrId: AppNotification | string,
  action: 'accept' | 'reject',
): Promise<{ success: boolean; playlistId?: string; error: Error | null }> {
  const notifId = typeof notificationOrId === 'string' ? notificationOrId : notificationOrId.id
  const localList = getLocalNotifications()
  const foundLocal = localList.find((n) => n.id === notifId)
  const target: AppNotification | null =
    typeof notificationOrId !== 'string' ? notificationOrId : foundLocal || null

  const newStatus: 'accepted' | 'rejected' = action === 'accept' ? 'accepted' : 'rejected'

  // Get current user identity to register properly
  const activeLocal = getActiveLocalUser()
  let callerUserId: string | undefined = activeLocal?.id
  let callerDisplayName: string | undefined = activeLocal?.displayName
  const { data: authData } = await supabase.auth.getUser()
  if (authData?.user) {
    callerUserId = authData.user.id
    callerDisplayName =
      authData.user.user_metadata?.display_name ||
      authData.user.email?.split('@')[0] ||
      callerDisplayName
  }

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const isDbId = UUID_REGEX.test(notifId)

  // 1. Supabase database acceptance/rejection via stored procedure
  if (isDbId && isSupabaseConfigured() && authData?.user) {
    if (action === 'accept') {
      const { data, error } = await acceptInvitationById(notifId)
      if (error) {
        return { success: false, error }
      }
      if (data?.playlist_id) {
        if (foundLocal) {
          foundLocal.status = 'accepted'
          saveLocalNotifications(localList)
        }
        dispatchNotificationsUpdated()
        return { success: true, playlistId: data.playlist_id, error: null }
      }
    } else {
      const { error } = await declineInvitationById(notifId)
      if (error) {
        return { success: false, error }
      }
      if (foundLocal) {
        foundLocal.status = 'rejected'
        saveLocalNotifications(localList)
      }
      dispatchNotificationsUpdated()
      return { success: true, error: null }
    }
  }

  // 2. Update server status
  try {
    if (typeof fetch === 'function') {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: notifId,
          status: newStatus,
          userId: callerUserId,
          displayName: callerDisplayName,
        }),
      }).catch(() => null)
    }
  } catch {
    // Non-blocking
  }

  // 3. Update local notifications
  if (foundLocal) {
    foundLocal.status = newStatus
    saveLocalNotifications(localList)
  } else if (target) {
    const updated = { ...target, status: newStatus }
    localList.unshift(updated)
    saveLocalNotifications(localList)
  }

  const playlistId = target?.playlistId

  // 4. If accepting via link token or fallback
  if (action === 'accept' && target) {
    if (target.rawToken) {
      await acceptPlaylistInvitation(target.rawToken)
    }

    if (playlistId) {
      try {
        if (typeof fetch === 'function') {
          await fetch('/api/playlists/collaborators', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              playlistId,
              userId: callerUserId || target.recipientUserId,
              displayName: callerDisplayName || target.recipientDisplayName || 'Collaborator',
              role: target.role || 'editor',
            }),
          }).catch(() => null)
        }
      } catch {
        // Non-blocking
      }

      const full = await fetchServerFullPlaylist(playlistId)
      if (full?.playlist) {
        saveLocalPlaylist(full.playlist)
        for (const tr of full.playlist_tracks || []) {
          saveLocalPlaylistTrack(tr)
        }
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('orbim:playlist-updated', {
            detail: { playlistId, action: 'member_added' },
          }),
        )
      }
    }
  }

  dispatchNotificationsUpdated()
  return { success: true, playlistId, error: null }
}

/**
 * Deletes a notification.
 */
export async function deleteNotification(notificationId: string): Promise<void> {
  try {
    if (typeof fetch === 'function') {
      await fetch(`/api/notifications?id=${encodeURIComponent(notificationId)}`, {
        method: 'DELETE',
      })
    }
  } catch {
    // Non-blocking
  }

  const list = getLocalNotifications().filter((n) => n.id !== notificationId)
  saveLocalNotifications(list)
  dispatchNotificationsUpdated()
}
