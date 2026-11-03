import { isSupabaseConfigured, supabase } from '../../lib/supabase.ts'
import { isUserAdmin } from '../../features/auth/admin.ts'
import type { MusicTrack, Playlist } from '../../types/music.ts'
import {
  getActiveLocalUser,
  getLocalPlaylists,
  getLocalPlaylistTracks,
} from '../auth/local-auth-store.ts'
import { getCatalogTrack } from '../catalog/global-catalog-service.ts'
import { addTrackToPlaylist } from './supabase-playlist.ts'

export interface AddToPlaylistOption {
  id: string
  title: string
  description?: string
  visibility: 'private' | 'shared'
  trackCount: number
  ownerId: string
  updatedAt: string
}

export interface ResolveAddToPlaylistOptionsParams {
  user: { id: string } | null
  isDemo: boolean
  remotePlaylists: AddToPlaylistOption[]
  mockPlaylists?: Playlist[]
  isLoading?: boolean
  loadError?: string | null
}

export type AddToPlaylistUIState =
  | { type: 'demo'; playlists: Playlist[] }
  | { type: 'guest' }
  | { type: 'loading' }
  | { type: 'error'; message: string }
  | { type: 'empty' }
  | { type: 'ready'; playlists: AddToPlaylistOption[] }

/**
 * Resolves the UI presentation state for AddToPlaylistDialog.
 *
 * Rules:
 * 1. Demo mode (`isDemo: true`) strictly isolates mock playlists.
 * 2. Unauthenticated visitors in Supabase mode (`isDemo: false`) receive guest state
 *    (sign-in prompt) and never see private remote data or mock items.
 * 3. Loading state takes precedence during in-flight queries.
 * 4. Error state preserves query failures and does not fall back to mock data.
 * 5. Empty state handles authenticated users with 0 writable playlists without mock fallback.
 * 6. Ready state presents only authorized remote playlists.
 */
export function resolveAddToPlaylistUIState(
  params: ResolveAddToPlaylistOptionsParams,
): AddToPlaylistUIState {
  if (params.isDemo) {
    return {
      type: 'demo',
      playlists: params.mockPlaylists ?? [],
    }
  }

  if (!params.user) {
    return {
      type: 'guest',
    }
  }

  if (params.isLoading) {
    return {
      type: 'loading',
    }
  }

  if (params.loadError) {
    return {
      type: 'error',
      message: params.loadError,
    }
  }

  if (params.remotePlaylists.length === 0) {
    return {
      type: 'empty',
    }
  }

  return {
    type: 'ready',
    playlists: params.remotePlaylists,
  }
}

/**
 * Checks if a track already exists in a given list of track identifiers,
 * adhering to the unique constraint (playlist_id, provider, provider_track_id).
 */
export function isDuplicateTrackInList(
  existingTracks: Array<{ provider: string; providerTrackId: string }>,
  track: { provider?: string; providerTrackId: string },
): boolean {
  const provider = track.provider || 'orbim'
  return existingTracks.some(
    (t) => t.provider === provider && t.providerTrackId === track.providerTrackId,
  )
}

/**
 * Classifies whether an error from PostgreSQL/PostgREST is a unique constraint violation
 * on playlist_tracks (constraint: playlist_track_unique).
 */
export function isDuplicateConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as { code?: string; message?: string }
  if (err.code === '23505') return true
  if (typeof err.message === 'string') {
    return (
      err.message.includes('playlist_track_unique') ||
      err.message.includes('duplicate key value') ||
      err.message.includes('unique constraint')
    )
  }
  return false
}

/**
 * Filters playlists to those the user has authorization to add tracks to.
 * Authorization requires either being the owner or an active member in playlist_members.
 */
export function filterAuthorizedPlaylists<T extends { id: string; owner_id: string }>(
  playlists: T[],
  userId: string,
  memberPlaylistIds: Set<string>,
): T[] {
  return playlists.filter((p) => p.owner_id === userId || memberPlaylistIds.has(p.id))
}

/**
 * Fetches playlists that the current authenticated user has authorization to add tracks to,
 * along with up-to-date track counts.
 */
export async function fetchUserWritablePlaylists(userId: string): Promise<{
  data: AddToPlaylistOption[] | null
  error: Error | null
}> {
  const activeLocal = getActiveLocalUser()

  // 1. Fetch user's active memberships (owner or editor)
  const { data: memberRows, error: memberError } = await supabase
    .from('playlist_members')
    .select('playlist_id')
    .eq('user_id', userId)

  // If member fetch failed (e.g. unauthenticated in Supabase) and active local user matches, fallback cleanly
  if (memberError && activeLocal && activeLocal.id === userId) {
    const localPlaylists = getLocalPlaylists(userId)
    const localTracks = getLocalPlaylistTracks()
    const result: AddToPlaylistOption[] = localPlaylists.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description || undefined,
      visibility: p.visibility as 'private' | 'shared',
      trackCount: localTracks.filter((t) => t.playlist_id === p.id).length,
      ownerId: p.owner_id,
      updatedAt: p.updated_at,
    }))
    return { data: result, error: null }
  }

  if (memberError) {
    return { data: null, error: memberError }
  }

  const memberPlaylistIds = new Set((memberRows || []).map((r) => r.playlist_id))

  // 2. Fetch playlists
  const { data: playlists, error: playlistError } = await supabase
    .from('playlists')
    .select('*')
    .order('updated_at', { ascending: false })

  if (playlistError) {
    return { data: null, error: playlistError }
  }

  // 3. Filter to authorized playlists where user is owner or collaborator member
  const authorized = filterAuthorizedPlaylists(playlists || [], userId, memberPlaylistIds)

  // 4. Fetch track counts for authorized playlists
  const playlistIds = authorized.map((p) => p.id)
  const trackCounts: Record<string, number> = {}

  if (playlistIds.length > 0) {
    const { data: trackRows, error: trackError } = await supabase
      .from('playlist_tracks')
      .select('playlist_id')
      .in('playlist_id', playlistIds)

    if (!trackError && trackRows) {
      for (const row of trackRows) {
        trackCounts[row.playlist_id] = (trackCounts[row.playlist_id] || 0) + 1
      }
    }
  }

  const result: AddToPlaylistOption[] = authorized.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description || undefined,
    visibility: p.visibility as 'private' | 'shared',
    trackCount: trackCounts[p.id] || 0,
    ownerId: p.owner_id,
    updatedAt: p.updated_at,
  }))

  // Also include any local playlists owned by this user
  const localPlaylists = getLocalPlaylists(userId)
  if (localPlaylists.length > 0) {
    const localTracks = getLocalPlaylistTracks()
    const localOptions: AddToPlaylistOption[] = localPlaylists.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description || undefined,
      visibility: p.visibility as 'private' | 'shared',
      trackCount: localTracks.filter((t) => t.playlist_id === p.id).length,
      ownerId: p.owner_id,
      updatedAt: p.updated_at,
    }))
    const existingIds = new Set(result.map((r) => r.id))
    return { data: [...localOptions.filter((o) => !existingIds.has(o.id)), ...result], error: null }
  }

  return { data: result, error: null }
}

export interface AddTrackResult {
  success: boolean
  isDuplicate?: boolean
  error?: Error | null
}

/**
 * Adds a music track to a user's playlist with duplicate prevention
 * and verified persistence confirmation.
 */
export async function addTrackToUserPlaylist(params: {
  playlistId: string
  track: MusicTrack
}): Promise<AddTrackResult> {
  const { playlistId, track } = params
  const provider = track.provider || 'orbim'
  const providerTrackId = track.providerTrackId

  // 1. Authorize publication status: Regular users cannot add unpublished or draft tracks
  let callerEmail: string | null | undefined = undefined
  if (isSupabaseConfigured()) {
    try {
      const { data: authData } = await supabase.auth.getUser()
      callerEmail = authData?.user?.email
    } catch {
      // non-blocking
    }
  }

  if (!callerEmail) {
    const activeLocal = getActiveLocalUser()
    callerEmail = activeLocal?.email
  }

  const isAdmin = isUserAdmin(callerEmail)

  const catalogRecord = track.catalogTrackId
    ? getCatalogTrack(track.catalogTrackId, callerEmail)
    : getCatalogTrack(providerTrackId, callerEmail)

  if (!isAdmin) {
    if (track.publicationStatus && track.publicationStatus !== 'published') {
      return {
        success: false,
        error: new Error('Cannot add unpublished track to playlist. Only published tracks can be added.'),
      }
    }

    if (catalogRecord && catalogRecord.publicationStatus !== 'published') {
      return {
        success: false,
        error: new Error('Cannot add unpublished track to playlist. Track is not published.'),
      }
    }
  }

  const effectiveTrack: MusicTrack = {
    ...track,
    catalogTrackId: track.catalogTrackId || catalogRecord?.id,
  }

  // 2. Check if target playlist is in local storage
  const localPlaylists = getLocalPlaylists()
  const isTargetLocal = localPlaylists.some((p) => p.id === playlistId)

  if (isTargetLocal) {
    const existingLocalTracks = getLocalPlaylistTracks(playlistId)
    const isDup = existingLocalTracks.some(
      (t) => t.provider === provider && t.provider_track_id === providerTrackId,
    )
    if (isDup) {
      return {
        success: false,
        isDuplicate: true,
        error: new Error('This track is already in the selected playlist.'),
      }
    }

    const { error: addErr } = await addTrackToPlaylist({
      playlistId,
      track: effectiveTrack,
      addedVia: 'web_ui',
    })

    if (addErr) {
      return { success: false, error: addErr }
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('orbim:playlist-updated', {
          detail: { playlistId, action: 'track_added' },
        }),
      )
    }

    return { success: true }
  }

  if (!isSupabaseConfigured()) {
    return {
      success: true,
    }
  }

  // 3. Pre-check: verify whether track already exists in target Supabase playlist
  const { data: existing, error: checkError } = await supabase
    .from('playlist_tracks')
    .select('id')
    .eq('playlist_id', playlistId)
    .eq('provider', provider)
    .eq('provider_track_id', providerTrackId)
    .limit(1)
    .maybeSingle()

  if (checkError) {
    return {
      success: false,
      isDuplicate: false,
      error: checkError,
    }
  }

  if (existing) {
    return {
      success: false,
      isDuplicate: true,
      error: new Error(`This track is already in the selected playlist.`),
    }
  }

  // 3. Perform insertion via existing addTrackToPlaylist database provider
  const { data, error } = await addTrackToPlaylist({
    playlistId,
    track: effectiveTrack,
    addedVia: 'web_ui',
  })

  if (error) {
    if (isDuplicateConstraintError(error)) {
      return {
        success: false,
        isDuplicate: true,
        error: new Error(`This track is already in the selected playlist.`),
      }
    }

    return {
      success: false,
      isDuplicate: false,
      error,
    }
  }

  if (!data) {
    return {
      success: false,
      error: new Error('Failed to confirm track insertion in database.'),
    }
  }

  return {
    success: true,
  }
}
