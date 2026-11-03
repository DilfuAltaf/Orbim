import { getDataSource, getSupabaseAuthHeaders, isSupabaseConfigured, supabase } from '../../lib/supabase.ts'
import {
  getAllLocalUsers,
  getLocalPlaylists,
  getLocalPlaylistTracks,
} from '../auth/local-auth-store.ts'
import { dedupeCandidates } from '../playlist/invitation-lifecycle.ts'

export interface UserCandidate {
  id: string
  displayName: string
  /** Present only for the active browser's own local accounts; never rendered or sent. */
  email?: string
  avatarUrl?: string | null
  location?: string | null
  /** Static demo directory entries are not real ORBIM accounts and cannot be invited. */
  isDemoUser?: boolean
}

export interface SearchIdentity {
  id?: string | null
  email?: string | null
  displayName?: string | null
}

export interface SearchCollaboratorOptions {
  /** Canonical ids that must not be offered again (owner + existing collaborators). */
  excludeUserIds?: string[]
}

export const FALLBACK_USERS: UserCandidate[] = [
  { id: 'usr-mira-01', displayName: 'Mira K.', location: 'Lisbon, PT', isDemoUser: true },
  { id: 'usr-dima-02', displayName: 'Dima S.', location: 'St. Petersburg, RU', isDemoUser: true },
  { id: 'usr-ana-03', displayName: 'Ana Reyes', location: 'Manila, PH', isDemoUser: true },
  { id: 'usr-june-04', displayName: 'June Park', location: 'Seoul, KR', isDemoUser: true },
  { id: 'usr-alex-05', displayName: 'Alex Rivers', location: 'Berlin, DE', isDemoUser: true },
  { id: 'usr-sarah-06', displayName: 'Sarah Connor', location: 'Los Angeles, US', isDemoUser: true },
]

function normalizeIdentity(
  currentUser?: string | SearchIdentity | null,
): SearchIdentity {
  if (!currentUser) return {}
  if (typeof currentUser === 'string') return { id: currentUser }
  return {
    id: currentUser.id || null,
    email: currentUser.email || null,
    displayName: currentUser.displayName || null,
  }
}

/**
 * Searches real ORBIM accounts by username (display name).
 *
 * Every source is merged through the canonical-user deduplication in the shared
 * invitation lifecycle, so one account is returned exactly once even when it is
 * visible through several stores (Supabase profile, dev registry, local store).
 */
export async function searchCollaboratorCandidates(
  query: string,
  currentUser?: string | SearchIdentity | null,
  options: SearchCollaboratorOptions = {},
): Promise<UserCandidate[]> {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return []

  const isDemo = getDataSource() === 'demo'
  const identity = normalizeIdentity(currentUser)
  const excludedIds = new Set(
    [identity.id, ...(options.excludeUserIds || [])]
      .filter((v): v is string => Boolean(v))
      .map((id) => id.trim().toLowerCase()),
  )
  const excludedNames = new Set(
    [identity.displayName]
      .filter((v): v is string => Boolean(v))
      .map((v) => v!.trim().toLowerCase()),
  )
  const excludedEmails = new Set(
    [identity.email]
      .filter((v): v is string => Boolean(v))
      .map((v) => v!.trim().toLowerCase()),
  )

  // Only a real Supabase session can invite real Supabase profiles (their
  // canonical id must be an auth UUID matching public.profiles). A browser
  // running on a local identity in live-data mode has no Supabase JWT, so
  // public.profiles is invisible to RLS and the dev registry / local store is
  // the only directory that can actually receive those invitations.
  const isLiveMode = !isDemo && isSupabaseConfigured()
  let hasSupabaseSession = false
  if (isLiveMode) {
    try {
      const { data } = await supabase.auth.getUser()
      hasSupabaseSession = Boolean(data?.user)
    } catch {
      hasSupabaseSession = false
    }
  }
  function isCanonicalSupabaseAccountId(id: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  }

  // Collect raw sources alongside their priority. Higher priority wins the
  // canonical id when the same account is present under more than one id.
  const raw: Array<UserCandidate & { priority: number }> = []

  // 1. Canonical Supabase profiles (highest priority: this id owns the inbox).
  if (!isDemo) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url, location')
        .ilike('display_name', `%${trimmed}%`)
        .limit(10)

      if (!error && data) {
        for (const p of data) {
          if (p?.id && p?.display_name) {
            raw.push({
              id: p.id,
              displayName: p.display_name,
              avatarUrl: p.avatar_url,
              location: p.location,
              priority: 3,
            })
          }
        }
      }
    } catch {
      // Offline / unconfigured: real candidates from other sources still apply.
    }
  }

  // 2. Registered accounts from the dev server (emails deliberately not returned).
  try {
    if (typeof fetch === 'function') {
      const authHeaders = await getSupabaseAuthHeaders()
      const res = await fetch(`/api/users?q=${encodeURIComponent(trimmed)}`, {
        headers: { Accept: 'application/json', ...authHeaders },
      })
      if (res.ok) {
        const payload = (await res.json()) as { users?: UserCandidate[] }
        if (payload?.users && Array.isArray(payload.users)) {
          for (const u of payload.users) {
            if (u?.id && u?.displayName) {
              if (hasSupabaseSession && !isCanonicalSupabaseAccountId(u.id)) {
                continue
              }
              raw.push({ ...u, priority: 2 })
            }
          }
        }
      }
    }
  } catch {
    // Non-blocking in test / offline environments
  }

  // 3. Local accounts known to this browser (always relevant while the active
  // identity is not a Supabase session; their invitations travel via the dev
  // server registry).
  try {
    if (!hasSupabaseSession) {
      for (const u of getAllLocalUsers()) {
        if (u.id && u.displayName) {
          raw.push({
            id: u.id,
            displayName: u.displayName,
            email: u.email,
            location: 'Akun lokal',
            priority: 1,
          })
        }
      }
    }
  } catch {
    // Non-blocking
  }

  // 4. Static demo directory entries (priority 0: lowest priority fallback)
  try {
    if (!isLiveMode) {
      for (const fb of FALLBACK_USERS) {
        raw.push({ ...fb, priority: 0 })
      }
    }
  } catch {
    // Non-blocking
  }

  const matching = raw.filter((candidate) => {
    if (!candidate || !candidate.id || !candidate.displayName) return false
    const candId = candidate.id.trim().toLowerCase()
    if (excludedIds.has(candId)) return false
    const email = (candidate.email || '').trim().toLowerCase()
    if (email && excludedEmails.has(email)) return false
    const name = candidate.displayName.trim().toLowerCase()
    if (name && excludedNames.has(name)) return false
    return name.includes(trimmed) || email.includes(trimmed)
  })

  // `dedupeCandidates` guarantees a single entry per canonical identity.
  return dedupeCandidates(matching).map(({ id, displayName, avatarUrl, location, isDemoUser }) => ({
    id,
    displayName,
    avatarUrl,
    location,
    isDemoUser,
  }))
}

/**
 * Adds a collaborator to an existing playlist by user candidate.
 * Kept for the playlist-creation flow; invitation consent flows use the shared
 * invitation lifecycle instead.
 */
export async function addCollaboratorToPlaylist(
  playlistId: string,
  collaborator: UserCandidate,
  role: 'editor' = 'editor',
): Promise<{ error: Error | null }> {
  const isDemo = getDataSource() === 'demo'

  // 1. Ensure the playlist and tracks are synced to dev server
  try {
    const localPlaylists = getLocalPlaylists()
    const foundPl = localPlaylists.find((p) => p.id === playlistId)
    if (foundPl && typeof fetch === 'function') {
      const localTracks = getLocalPlaylistTracks(playlistId)
      const authHeaders = await getSupabaseAuthHeaders()
      void fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ playlist: foundPl, tracks: localTracks }),
      }).catch(() => null)
    }
  } catch {
    // Non-blocking
  }

  // 2. Persist to server collaborators registry
  try {
    if (typeof fetch === 'function') {
      const authHeaders = await getSupabaseAuthHeaders()
      void fetch('/api/playlists/collaborators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          playlistId,
          userId: collaborator.id,
          displayName: collaborator.displayName,
          location: collaborator.location || '',
          role,
        }),
      }).catch(() => null)
    }
  } catch {
    // Non-blocking
  }

  if (!isDemo) {
    try {
      // Try secure RPC if configured
      const rpcCaller = supabase.rpc as unknown as (
        fn: string,
        params: Record<string, unknown>,
      ) => Promise<{ error: Error | null }>
      const { error: rpcError } = await rpcCaller('add_playlist_collaborator', {
        p_playlist_id: playlistId,
        p_collaborator_id: collaborator.id,
        p_role: role,
      })

      if (!rpcError) {
        dispatchPlaylistUpdated(playlistId)
        return { error: null }
      }

      // Try direct insert into playlist_members
      const { error: insertError } = await supabase.from('playlist_members').insert({
        playlist_id: playlistId,
        user_id: collaborator.id,
        role,
      })

      if (!insertError) {
        dispatchPlaylistUpdated(playlistId)
        return { error: null }
      }

      // Both trusted paths failed: report the underlying database error instead
      // of pretending success.
      return {
        error: new Error(insertError.message || rpcError.message),
      }
    } catch (err) {
      console.warn('Failed to add collaborator in Supabase:', err)
      return { error: err instanceof Error ? err : new Error(String(err)) }
    }
  }

  // Dispatch event so local listeners update
  dispatchPlaylistUpdated(playlistId)
  return { error: null }
}

function dispatchPlaylistUpdated(playlistId: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('orbim:playlist-updated', {
        detail: { playlistId, action: 'member_added' },
      }),
    )
  }
}
