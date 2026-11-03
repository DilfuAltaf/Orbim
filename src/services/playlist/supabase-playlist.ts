import { getDataSource, isSupabaseConfigured, supabase } from '../../lib/supabase.ts'
import type { Database } from '../../types/database.ts'
import type { MusicTrack } from '../../types/music.ts'
import {
  getActiveLocalUser,
  getLocalPlaylists,
  saveLocalPlaylist,
  deleteLocalPlaylist,
  getLocalPlaylistTracks,
  saveLocalPlaylistTrack,
  removeLocalPlaylistTrack,
  type LocalPlaylistRecord,
  type LocalPlaylistTrackRecord,
} from '../auth/local-auth-store.ts'
import { findGlobalAudioForTrack } from '../audio/global-audio-registry.ts'

export type SupabasePlaylistRow = Database['public']['Tables']['playlists']['Row']
export type SupabaseTrackRow = Database['public']['Tables']['playlist_tracks']['Row']
export type SupabaseMemberRow = Database['public']['Tables']['playlist_members']['Row']

/**
 * Syncs a playlist record and optionally its tracks to the local Vite dev server for cross-user/browser access.
 */
export async function syncPlaylistToServer(
  playlist: {
    id: string
    title: string
    description?: string | null
    owner_id: string
    visibility?: string
    created_at?: string
    updated_at?: string
  },
  tracks?: unknown[],
): Promise<void> {
  try {
    if (typeof fetch === 'function') {
      await fetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlist, tracks }),
      })
    }
  } catch {
    // Non-blocking
  }
}

/**
 * Syncs a track to the server for cross-user/browser access.
 */
export async function syncTrackToServer(track: {
  id: string
  playlist_id: string
  provider?: string
  provider_track_id: string
  title: string
  artist_name: string
  album_name?: string | null
  artwork_url?: string | null
  duration_seconds?: number
  position: number
  added_by?: string
  added_via?: string
  verification_status?: string
  audio_url?: string | null
  storage_path?: string | null
  audio_source_type?: string
  catalog_track_id?: string | null
  created_at?: string
}): Promise<void> {
  try {
    if (typeof fetch === 'function') {
      await fetch('/api/playlists/tracks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track }),
      })
    }
  } catch {
    // Non-blocking
  }
}

/**
 * Fetches the full playlist, tracks, and members from the dev server.
 */
export async function fetchServerFullPlaylist(playlistId: string): Promise<{
  playlist: LocalPlaylistRecord
  playlist_tracks: LocalPlaylistTrackRecord[]
  playlist_members: Array<{
    id: string
    playlist_id: string
    user_id: string
    role: string
    joined_at: string
  }>
} | null> {
  try {
    if (typeof fetch === 'function') {
      const res = await fetch(`/api/playlists?playlistId=${encodeURIComponent(playlistId)}`)
      if (res.ok) {
        const payload = (await res.json()) as {
          success?: boolean
          data?: {
            playlist: LocalPlaylistRecord
            playlist_tracks: LocalPlaylistTrackRecord[]
            playlist_members: Array<{
              id: string
              playlist_id: string
              user_id: string
              role: string
              joined_at: string
            }>
          }
        }
        if (payload?.success && payload.data) {
          return payload.data
        }
      }
    }
  } catch {
    // Non-blocking
  }
  return null
}

/**
 * Fetches user-accessible playlists from the dev server (owned and collaborative).
 */
export async function fetchServerUserPlaylists(
  userQuery?: string | { userId?: string; email?: string; displayName?: string },
): Promise<LocalPlaylistRecord[]> {
  try {
    if (typeof fetch === 'function') {
      const params = new URLSearchParams()
      if (typeof userQuery === 'string') {
        if (userQuery.trim()) params.set('userId', userQuery.trim())
      } else if (userQuery && typeof userQuery === 'object') {
        if (userQuery.userId?.trim()) params.set('userId', userQuery.userId.trim())
        if (userQuery.email?.trim()) params.set('email', userQuery.email.trim())
        if (userQuery.displayName?.trim()) params.set('displayName', userQuery.displayName.trim())
      }
      const q = params.toString() ? `?${params.toString()}` : ''
      const res = await fetch(`/api/playlists${q}`)
      if (res.ok) {
        const payload = (await res.json()) as {
          success?: boolean
          playlists?: LocalPlaylistRecord[]
        }
        if (payload?.success && Array.isArray(payload.playlists)) {
          return payload.playlists
        }
      }
    }
  } catch {
    // Non-blocking
  }
  return []
}

/**
 * Computes SHA-256 hex digest using Web Crypto API.
 */
export async function hashInvitationToken(token: string): Promise<string> {
  const normalized = token.trim().toLowerCase()
  const encoded = new TextEncoder().encode(normalized)
  const buffer = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generates a cryptographically random invitation token (64 hex chars).
 */
export function generateInvitationToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Creates a new playlist in Supabase or local store.
 */
export async function createSupabasePlaylist(params: {
  title: string
  description?: string
  visibility?: Database['public']['Tables']['playlists']['Row']['visibility']
}): Promise<{ data: SupabasePlaylistRow | null; error: Error | null }> {
  let authUserId: string | null = null
  try {
    const { data: authData } = await supabase.auth.getUser()
    authUserId = authData.user?.id ?? null
  } catch {
    // non-blocking
  }

  const activeLocal = getActiveLocalUser()

  // If authenticated via local user store (or no active Supabase session)
  if (!authUserId && activeLocal) {
    const now = new Date().toISOString()
    const localRecord: LocalPlaylistRecord = {
      id: crypto.randomUUID(),
      owner_id: activeLocal.id,
      title: params.title.trim(),
      description: params.description?.trim() || null,
      visibility: params.visibility || 'private',
      created_at: now,
      updated_at: now,
    }
    saveLocalPlaylist(localRecord)
    void syncPlaylistToServer(localRecord)
    return { data: localRecord as SupabasePlaylistRow, error: null }
  }

  if (!authUserId) {
    return { data: null, error: new Error('Authentication required to create a playlist.') }
  }

  const { data, error } = await supabase
    .from('playlists')
    .insert({
      owner_id: authUserId,
      title: params.title.trim(),
      description: params.description?.trim() || null,
      visibility: params.visibility || 'private',
    })
    .select()
    .single()

  if (data) {
    void syncPlaylistToServer(data)
  }

  return { data, error }
}

/**
 * Detects whether an insert failed because the deployed database is missing the optional
 * audio columns (audio_url / storage_path / audio_source_type).
 */
function isMissingAudioColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === '42703' || error.code === 'PGRST204') return true
  const message = (error.message || '').toLowerCase()
  return message.includes('does not exist') && message.includes('column')
}

/**
 * Returns a copy of a playlist_tracks row without the optional audio columns.
 */
function withoutAudioColumns<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...row }
  delete copy.audio_url
  delete copy.storage_path
  delete copy.audio_source_type
  delete copy.catalog_track_id
  return copy
}

/**
 * Fetches all playlists accessible to the current user (owned or shared).
 */
export async function fetchUserPlaylists(): Promise<{
  data: SupabasePlaylistRow[] | null
  error: Error | null
}> {
  const activeLocal = getActiveLocalUser()

  let authUserId: string | null = null
  let authEmail: string | null = null
  let authName: string | null = null
  try {
    const { data: authData } = await supabase.auth.getUser()
    if (authData?.user) {
      authUserId = authData.user.id
      authEmail = authData.user.email ?? null
      authName =
        authData.user.user_metadata?.display_name ||
        authData.user.email?.split('@')[0] ||
        null
    }
  } catch {
    // non-blocking
  }

  const userQuery = {
    userId: authUserId || activeLocal?.id,
    email: authEmail || activeLocal?.email,
    displayName: authName || activeLocal?.displayName,
  }
  const serverPlaylists = await fetchServerUserPlaylists(userQuery)

  // If local user is active and no Supabase session:
  if (!authUserId && activeLocal) {
    const localList = getLocalPlaylists()
    const map = new Map<string, SupabasePlaylistRow>()
    for (const p of serverPlaylists) {
      map.set(p.id, p as unknown as SupabasePlaylistRow)
    }
    for (const p of localList) {
      if (p.owner_id === activeLocal.id || map.has(p.id)) {
        map.set(p.id, p as unknown as SupabasePlaylistRow)
      }
    }
    return { data: Array.from(map.values()), error: null }
  }

  const { data, error } = await supabase
    .from('playlists')
    .select('*')
    .order('updated_at', { ascending: false })

  const map = new Map<string, SupabasePlaylistRow>()
  for (const p of serverPlaylists) {
    map.set(p.id, p as unknown as SupabasePlaylistRow)
  }
  for (const p of data || []) {
    map.set(p.id, p)
  }
  if (activeLocal) {
    const localList = getLocalPlaylists(activeLocal.id) as SupabasePlaylistRow[]
    for (const p of localList) {
      map.set(p.id, p)
    }
  }

  return { data: Array.from(map.values()), error }
}

/**
 * Builds the playlist_tracks insert payload for a single track.
 */
export function buildPlaylistTrackRow(params: {
  playlistId: string
  track: MusicTrack
  userId: string
  position: number
  addedVia?: 'web_ui' | 'ai_cli' | 'bulk_import'
}): Record<string, unknown> {
  const provider = params.track.provider || 'orbim'
  const isStorageAudio = Boolean(params.track.storagePath) || params.track.audioSourceType === 'storage'
  const isDirectStream = params.track.audioSourceType === 'direct_stream'
  const persistAudio = isStorageAudio || isDirectStream || (provider !== 'spotify' && provider !== 'vybe')

  return {
    playlist_id: params.playlistId,
    provider,
    provider_track_id: params.track.providerTrackId,
    title: params.track.title,
    artist_name: params.track.artistName,
    album_name: params.track.albumName || null,
    artwork_url: params.track.artworkUrl || null,
    duration_seconds: params.track.durationSeconds || 0,
    position: params.position,
    added_by: params.userId,
    added_via: params.addedVia || 'web_ui',
    verification_status: 'unverified' as const,
    audio_url: persistAudio ? params.track.audioSourceUrl || params.track.playbackUrl || null : null,
    storage_path: persistAudio ? params.track.storagePath || null : null,
    audio_source_type: persistAudio ? params.track.audioSourceType || 'none' : 'none',
    catalog_track_id: params.track.catalogTrackId || null,
  }
}

/**
 * Adds a music track to a playlist (Supabase or local store).
 */
export async function addTrackToPlaylist(params: {
  playlistId: string
  track: MusicTrack
  addedVia?: 'web_ui' | 'ai_cli' | 'bulk_import'
}): Promise<{ data: SupabaseTrackRow | null; error: Error | null }> {
  // Check if target is a local playlist
  const localList = getLocalPlaylists()
  const isLocal = localList.some((p) => p.id === params.playlistId)

  if (isLocal) {
    const existingTracks = getLocalPlaylistTracks(params.playlistId)
    const activeLocal = getActiveLocalUser()
    const now = new Date().toISOString()
    const nextPos = (existingTracks.length + 1) * 1000.0

    let effectiveTrack = params.track
    if (!effectiveTrack.storagePath && effectiveTrack.providerTrackId) {
      const globalAudio = await findGlobalAudioForTrack(effectiveTrack.providerTrackId)
      if (globalAudio) {
        effectiveTrack = {
          ...effectiveTrack,
          storagePath: globalAudio.storagePath,
          audioSourceType: 'storage',
          playbackUrl: globalAudio.audioUrl,
          audioSourceUrl: globalAudio.audioUrl,
          isPlayable: true,
        }
      }
    }

    const localTrackRow: LocalPlaylistTrackRecord = {
      id: crypto.randomUUID(),
      playlist_id: params.playlistId,
      provider: effectiveTrack.provider || 'orbim',
      provider_track_id: effectiveTrack.providerTrackId,
      title: effectiveTrack.title,
      artist_name: effectiveTrack.artistName,
      album_name: effectiveTrack.albumName || null,
      artwork_url: effectiveTrack.artworkUrl || null,
      duration_seconds: effectiveTrack.durationSeconds || 0,
      position: nextPos,
      added_by: activeLocal?.id || 'local-user',
      added_via: params.addedVia || 'web_ui',
      verification_status: 'unverified',
      audio_url: effectiveTrack.audioSourceUrl || effectiveTrack.playbackUrl || null,
      storage_path: effectiveTrack.storagePath || null,
      audio_source_type: effectiveTrack.audioSourceType || 'none',
      catalog_track_id: effectiveTrack.catalogTrackId || null,
      created_at: now,
    }

    saveLocalPlaylistTrack(localTrackRow)
    void syncTrackToServer(localTrackRow)

    const pl = localList.find((p) => p.id === params.playlistId)
    if (pl) {
      pl.updated_at = now
      saveLocalPlaylist(pl)
      void syncPlaylistToServer(pl)
    }

    return { data: localTrackRow as unknown as SupabaseTrackRow, error: null }
  }

  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) {
    return { data: null, error: new Error('Authentication required to add tracks.') }
  }

  // Find max position
  const { data: maxTrack } = await supabase
    .from('playlist_tracks')
    .select('position')
    .eq('playlist_id', params.playlistId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextPosition = maxTrack ? Number(maxTrack.position) + 1000.0 : 1000.0

  let effectiveTrack = params.track
  if (!effectiveTrack.storagePath && effectiveTrack.providerTrackId) {
    const globalAudio = await findGlobalAudioForTrack(effectiveTrack.providerTrackId)
    if (globalAudio) {
      effectiveTrack = {
        ...effectiveTrack,
        storagePath: globalAudio.storagePath,
        audioSourceType: 'storage',
        playbackUrl: globalAudio.audioUrl,
        audioSourceUrl: globalAudio.audioUrl,
        isPlayable: true,
      }
    }
  }

  const row = buildPlaylistTrackRow({
    playlistId: params.playlistId,
    track: effectiveTrack,
    userId: authData.user.id,
    position: nextPosition,
    addedVia: params.addedVia,
  })

  let { data, error } = await supabase
    .from('playlist_tracks')
    .insert(row as never)
    .select()
    .single()

  // Environments without the audio migration must still accept Spotify metadata.
  if (error && isMissingAudioColumnError(error)) {
    const retry = await supabase
      .from('playlist_tracks')
      .insert(withoutAudioColumns(row) as never)
      .select()
      .single()
    data = retry.data
    error = retry.error
  }

  if (data) {
    void syncTrackToServer(data as unknown as LocalPlaylistTrackRecord)
  }

  return { data, error }
}

/**
 * Adds multiple music tracks to a Supabase playlist in a single batch.
 */
export async function addMultipleTracksToPlaylist(params: {
  playlistId: string
  tracks: MusicTrack[]
  addedVia?: 'web_ui' | 'ai_cli' | 'bulk_import'
}): Promise<{ data: SupabaseTrackRow[] | null; count: number; error: Error | null }> {
  if (params.tracks.length === 0) {
    return { data: [], count: 0, error: null }
  }

  const localList = getLocalPlaylists()
  const isLocal = localList.some((p) => p.id === params.playlistId)

  if (isLocal) {
    const inserted: SupabaseTrackRow[] = []
    for (const t of params.tracks) {
      const res = await addTrackToPlaylist({
        playlistId: params.playlistId,
        track: t,
        addedVia: params.addedVia,
      })
      if (res.data) inserted.push(res.data)
    }
    return { data: inserted, count: inserted.length, error: null }
  }

  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) {
    return { data: null, count: 0, error: new Error('Authentication required to add tracks.') }
  }

  // Find max position
  const { data: maxTrack } = await supabase
    .from('playlist_tracks')
    .select('position')
    .eq('playlist_id', params.playlistId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const startPosition = maxTrack ? Number(maxTrack.position) + 1000.0 : 1000.0

  const enrichedTracks = await Promise.all(
    params.tracks.map(async (t) => {
      if (!t.storagePath && t.providerTrackId) {
        const globalAudio = await findGlobalAudioForTrack(t.providerTrackId)
        if (globalAudio) {
          return {
            ...t,
            storagePath: globalAudio.storagePath,
            audioSourceType: 'storage' as const,
            playbackUrl: globalAudio.audioUrl,
            audioSourceUrl: globalAudio.audioUrl,
            isPlayable: true,
          }
        }
      }
      return t
    }),
  )

  const rows = enrichedTracks.map((track, i) => ({
    playlist_id: params.playlistId,
    provider: track.provider || 'custom',
    provider_track_id: track.providerTrackId || `custom_${Date.now()}_${i}`,
    title: track.title,
    artist_name: track.artistName,
    album_name: track.albumName || null,
    artwork_url: track.artworkUrl || null,
    duration_seconds: track.durationSeconds || 0,
    position: startPosition + (i * 1000.0),
    added_by: authData.user.id,
    added_via: params.addedVia || 'web_ui',
    verification_status: 'unverified' as const,
    audio_url: track.audioSourceUrl || track.playbackUrl || null,
    storage_path: track.storagePath || null,
    audio_source_type: track.audioSourceType || 'none',
    catalog_track_id: track.catalogTrackId || null,
  }))

  let { data, error } = await supabase
    .from('playlist_tracks')
    .insert(rows as never)
    .select()

  if (error && isMissingAudioColumnError(error)) {
    const retry = await supabase
      .from('playlist_tracks')
      .insert(rows.map(withoutAudioColumns) as never)
      .select()
    data = retry.data
    error = retry.error
  }

  return { data, count: data ? data.length : 0, error }
}

/**
 * Fetches the most recently added tracks the current user is allowed to read.
 */
export async function fetchRecentPlaylistTracks(
  limit = 5,
): Promise<{ data: SupabaseTrackRow[] | null; error: Error | null }> {
  const { data, error } = await supabase
    .from('playlist_tracks')
    .select('*')
    .order('added_at', { ascending: false })
    .limit(limit)

  return { data, error }
}

/**
 * Rebalances fractional track positions in a playlist via stored procedure.
 */
export async function rebalancePlaylistTracks(
  playlistId: string,
): Promise<{ error: Error | null }> {
  const { error } = await supabase.rpc('rebalance_playlist_track_positions', {
    p_playlist_id: playlistId,
  })

  return { error }
}

export function invitationErrorWithCode(
  message: string,
  code?: string | null,
): Error {
  const err = new Error(message)
  if (code) {
    ;(err as Error & { code?: string }).code = code
  }
  return err
}

export function isLiveSupabaseMode(): boolean {
  return isSupabaseConfigured() && getDataSource() !== 'demo'
}

/**
 * Creates an invitation for collaborators on a playlist.
 */
export async function createPlaylistInvitation(
  playlistId: string,
): Promise<{ rawToken: string | null; error: Error | null }> {
  let userId: string | null = null
  let authData: { user: { id: string } | null } | null = null
  try {
    const res = await supabase.auth.getUser()
    authData = res.data
  } catch {
    // Non-blocking
  }

  if (isLiveSupabaseMode() && !authData?.user) {
    return {
      rawToken: null,
      error: invitationErrorWithCode('Masuk ke ORBIM untuk membuat tautan undangan.'),
    }
  }

  if (authData?.user) {
    userId = authData.user.id
  } else {
    const local = getActiveLocalUser()
    userId = local ? local.id : 'owner'
  }

  const rawToken = generateInvitationToken()
  const tokenHash = await hashInvitationToken(rawToken)

  // 7 days validity
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  // 1. Ensure playlist and tracks are synced to dev server so any collaborator can load them!
  const localList = getLocalPlaylists()
  const foundPl = localList.find((p) => p.id === playlistId)
  if (foundPl) {
    const tracks = getLocalPlaylistTracks(playlistId)
    await syncPlaylistToServer(foundPl, tracks)
  } else if (isSupabaseConfigured()) {
    try {
      const { data: remoteData } = await supabase
        .from('playlists')
        .select('*, playlist_tracks(*)')
        .eq('id', playlistId)
        .maybeSingle()
      if (remoteData) {
        await syncPlaylistToServer(remoteData, remoteData.playlist_tracks)
      }
    } catch {
      // Non-blocking
    }
  }

  // 2. Persist to server registry for seamless cross-browser / local collaboration
  try {
    if (typeof fetch === 'function') {
      await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          rawToken,
          tokenHash,
          playlistId,
          role: 'editor',
          createdBy: userId,
          expiresAt,
        }),
      })
    }
  } catch {
    // Non-blocking
  }

  // 3. If authenticated in Supabase, also insert into remote Supabase database
  if (authData?.user && isSupabaseConfigured()) {
    try {
      const { error: insertError } = await supabase.from('playlist_invitations').insert({
        playlist_id: playlistId,
        token_hash: tokenHash,
        created_by: authData.user.id,
        role: 'editor',
        status: 'pending',
        expires_at: expiresAt,
      })
      if (insertError) {
        return {
          rawToken: null,
          error: invitationErrorWithCode(insertError.message, insertError.code),
        }
      }
    } catch (err) {
      return { rawToken: null, error: err instanceof Error ? err : new Error(String(err)) }
    }
  }

  return { rawToken, error: null }
}

/**
 * Creates an invitation addressed to a canonical user ID.
 */
export async function createUsernamePlaylistInvitation(
  playlistId: string,
  inviteeId: string,
  playlistTitle?: string,
): Promise<{
  data: { id: string; playlist_id: string; invitee_id: string; role: string; status: string } | null
  error: Error | null
}> {
  const { data: authData } = await supabase.auth.getUser()
  const currentUserId = authData?.user?.id || getActiveLocalUser()?.id || 'owner'

  // Live mode requires a real Supabase session so the invitation targets an
  // account that actually exists in Supabase (and whose inbox can read it).
  if (isLiveSupabaseMode()) {
    if (!authData?.user) {
      return {
        data: null,
        error: invitationErrorWithCode('Masuk ke ORBIM terlebih dahulu untuk mengirim undangan.'),
      }
    }

    // The invitee must be a real Supabase account (canonical auth UUID).
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inviteeId)) {
      return {
        data: null,
        error: invitationErrorWithCode(
          'Akun tujuan belum terdaftar sebagai akun ORBIM Supabase. Minta temanmu mendaftar lewat halaman Registrasi terlebih dahulu.',
          'ORB12',
        ),
      }
    }

    // Prevent self-invitation
    if (authData.user.id === inviteeId) {
      return { data: null, error: new Error('Anda tidak dapat mengundang diri sendiri.') }
    }

    // Check if user is already a member
    const { data: existingMember } = await supabase
      .from('playlist_members')
      .select('id, role')
      .eq('playlist_id', playlistId)
      .eq('user_id', inviteeId)
      .maybeSingle()
    if (existingMember) {
      return { data: null, error: new Error('Pengguna ini sudah menjadi anggota playlist.') }
    }

    // Check if an active invitation is already pending
    const { data: existingInvite } = await supabase
      .from('playlist_invitations')
      .select('id, status')
      .eq('playlist_id', playlistId)
      .eq('invitee_id', inviteeId)
      .eq('status', 'pending')
      .maybeSingle()
    if (existingInvite) {
      return { data: null, error: new Error('Undangan untuk pengguna ini sudah aktif.') }
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: inserted, error: insertError } = await supabase
      .from('playlist_invitations')
      .insert({
        playlist_id: playlistId,
        invitee_id: inviteeId,
        created_by: authData.user.id,
        role: 'editor',
        status: 'pending',
        expires_at: expiresAt,
      })
      .select('id, playlist_id, invitee_id, created_by, role, status, expires_at, created_at')
      .single()

    if (insertError) {
      if (insertError.code === '23505') {
        return { data: null, error: invitationErrorWithCode('Undangan untuk pengguna ini sudah aktif.', '23505') }
      }
      return {
        data: null,
        error: invitationErrorWithCode(insertError.message, insertError.code),
      }
    }

    // Also sync to dev server registry for hybrid local environments
    try {
      if (typeof fetch === 'function') {
        await fetch('/api/invitations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: inserted.id,
            playlistId,
            playlistTitle,
            inviteeId,
            role: 'editor',
            createdBy: currentUserId,
            status: 'pending',
            expiresAt,
          }),
        }).catch(() => null)
      }
    } catch {
      // Non-blocking
    }

    return { data: inserted as any, error: null }
  }

  // 2. Dev server fallback when Supabase is not configured
  const invId = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  try {
    if (typeof fetch === 'function') {
      const res = await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: invId,
          playlistId,
          playlistTitle,
          inviteeId,
          role: 'editor',
          createdBy: currentUserId,
          status: 'pending',
          expiresAt,
        }),
      })
      if (!res.ok) {
        return { data: null, error: new Error('Gagal menyimpan undangan di server.') }
      }
    }
  } catch {
    // Non-blocking
  }

  return {
    data: {
      id: invId,
      playlist_id: playlistId,
      invitee_id: inviteeId,
      role: 'editor',
      status: 'pending',
    },
    error: null,
  }
}

/**
 * Safely inspects invitation validity without consuming it (for link landing).
 */
export async function previewPlaylistInvitation(token: string): Promise<{
  valid: boolean
  status?: 'pending' | 'already_member' | string
  error_kind?: string
  playlist_id?: string
  playlist_title?: string
  inviter_name?: string
  role?: string
  error?: Error | null
}> {
  const cleanToken = token.trim()
  if (!cleanToken || cleanToken.length < 16) {
    return { valid: false, error_kind: 'invalid' }
  }

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('preview_playlist_invitation', {
        p_token: cleanToken,
      })
      if (!error && data) {
        return {
          valid: Boolean(data.valid),
          status: data.status,
          error_kind: data.error_kind,
          playlist_id: data.playlist_id,
          playlist_title: data.playlist_title,
          inviter_name: data.inviter_name,
          role: data.role,
          error: null,
        }
      }
    } catch {
      // Non-blocking fallback
    }
  }

  // Fallback to dev server
  try {
    if (typeof fetch === 'function') {
      const res = await fetch(`/api/invitations?token=${encodeURIComponent(cleanToken)}`)
      if (res.ok) {
        const payload = (await res.json()) as {
          invitations?: Array<{
            playlistId: string
            playlistTitle?: string
            rawToken?: string
            status?: string
            role?: string
            expiresAt?: string
            createdBy?: string
          }>
        }
        if (payload?.invitations) {
          const found = payload.invitations.find(
            (i) => i.rawToken?.toLowerCase() === cleanToken.toLowerCase(),
          )
          if (found) {
            const isExpired = found.expiresAt && new Date(found.expiresAt).getTime() <= Date.now()
            if (isExpired) {
              return { valid: false, error_kind: 'expired' }
            }
            if (found.status === 'revoked' || found.status === 'declined') {
              return { valid: false, error_kind: found.status }
            }
            return {
              valid: true,
              status: found.status || 'pending',
              playlist_id: found.playlistId,
              playlist_title: found.playlistTitle,
              role: found.role || 'editor',
            }
          }
        }
      }
    }
  } catch {
    // Non-blocking
  }

  return { valid: false, error_kind: 'invalid' }
}

/**
 * Accepts a playlist invitation via atomic stored procedure or server registry fallback.
 */
export async function acceptPlaylistInvitation(token: string): Promise<{
  data: Database['public']['Functions']['accept_playlist_invitation']['Returns'] | null
  error: Error | null
}> {
  const cleanToken = token.trim()

  // 1. Try Supabase RPC if logged into Supabase auth
  const { data: authData } = await supabase.auth.getUser()
  if (authData?.user && isSupabaseConfigured()) {
    const { data, error } = await supabase.rpc('accept_playlist_invitation', {
      p_token: cleanToken,
    })
    if (!error && data) {
      if (typeof window !== 'undefined' && data.playlist_id) {
        window.dispatchEvent(
          new CustomEvent('orbim:playlist-updated', {
            detail: { playlistId: data.playlist_id, action: 'member_added' },
          }),
        )
      }
      return { data, error: null }
    }
    if (error) {
      return {
        data: null,
        error: invitationErrorWithCode(error.message, error.code),
      }
    }
    // A real Supabase session got neither data nor an error: the database
    // invocation itself failed, so never silently degrade to the dev registry.
    return {
      data: null,
      error: invitationErrorWithCode(
        'Terjadi kesalahan pada server saat memproses undangan.',
        'PGRST102',
      ),
    }
  }

  // 2. Seamless server-side acceptance for local users or cross-browser collaboration
  const local = getActiveLocalUser()
  const callerId = authData?.user?.id || local?.id || 'guest-' + Date.now()
  const callerName =
    authData?.user?.user_metadata?.display_name || local?.displayName || 'Collaborator'

  try {
    if (typeof fetch === 'function') {
      const res = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: cleanToken,
          userId: callerId,
          displayName: callerName,
        }),
      })
      if (res.ok) {
        const payload = (await res.json()) as {
          success?: boolean
          status?: 'success' | 'already_member'
          playlistId?: string
          playlistTitle?: string
          role?: string
          error?: string
        }
        if (payload?.success && payload.playlistId) {
          const serverFull = await fetchServerFullPlaylist(payload.playlistId)
          if (serverFull?.playlist) {
            saveLocalPlaylist(serverFull.playlist)
            if (Array.isArray(serverFull.playlist_tracks)) {
              for (const tr of serverFull.playlist_tracks) {
                saveLocalPlaylistTrack(tr)
              }
            }
          }

          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('orbim:playlist-updated', {
                detail: { playlistId: payload.playlistId, action: 'member_added' },
              }),
            )
          }
          return {
            data: {
              status: (payload.status as 'success' | 'already_member') || 'success',
              playlist_id: payload.playlistId,
              playlist_title: payload.playlistTitle || '',
              role: (payload.role as 'editor') || 'editor',
            },
            error: null,
          }
        }
        if (payload?.error) {
          return { data: null, error: new Error(payload.error) }
        }
      } else {
        const errorBody = await res.json().catch(() => null)
        if (errorBody?.error) {
          return { data: null, error: new Error(errorBody.error) }
        }
      }
    }
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err : new Error('Network error accepting invitation'),
    }
  }

  return { data: null, error: new Error('Invalid or expired invitation token.') }
}

/**
 * Accepts an invitation by its database ID (used from notification inbox).
 */
export async function acceptInvitationById(invitationId: string): Promise<{
  data: { status: string; playlist_id: string; playlist_title: string; role: string } | null
  error: Error | null
}> {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.rpc('accept_playlist_invitation_by_id', {
      p_invitation_id: invitationId,
    })
    if (!error && data) {
      if (typeof window !== 'undefined' && data.playlist_id) {
        window.dispatchEvent(
          new CustomEvent('orbim:playlist-updated', {
            detail: { playlistId: data.playlist_id, action: 'member_added' },
          }),
        )
      }
      return { data, error: null }
    }
    if (error) {
      return {
        data: null,
        error: invitationErrorWithCode(error.message, error.code),
      }
    }
  }

  return { data: null, error: new Error('Could not accept invitation') }
}

/**
 * Declines an invitation by its database ID (used from notification inbox).
 */
export async function declineInvitationById(invitationId: string): Promise<{
  data: { status: string; invitation_id: string } | null
  error: Error | null
}> {
  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.rpc('decline_playlist_invitation', {
      p_invitation_id: invitationId,
    })
    if (!error && data) {
      return { data, error: null }
    }
    if (error) {
      return {
        data: null,
        error: invitationErrorWithCode(error.message, error.code),
      }
    }
  }

  return { data: { status: 'declined', invitation_id: invitationId }, error: null }
}

/**
 * Checks if current authenticated user holds platform administrator status.
 */
export async function checkIsAppAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_app_admin')
  if (error) return false
  return Boolean(data)
}

/**
 * Checks if current authenticated user holds automated/CLI operator authorization.
 */
export async function checkIsAppOperator(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_app_operator')
  if (error) return false
  return Boolean(data)
}

/**
 * Checks if current authenticated user has authority to verify a track.
 */
export async function checkCanVerifyTrack(trackId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_verify_track', { p_track_id: trackId })
  if (error) return false
  return Boolean(data)
}

/**
 * Verifies or rejects a playlist track contribution via trusted server RPC.
 */
export async function verifyPlaylistTrack(params: {
  trackId: string
  decision: 'verified' | 'rejected' | 'reset'
  notes?: string
}): Promise<{
  data: Database['public']['Functions']['verify_playlist_track']['Returns'] | null
  error: Error | null
}> {
  const { data, error } = await supabase.rpc('verify_playlist_track', {
    p_track_id: params.trackId,
    p_decision: params.decision,
    p_notes: params.notes,
  })

  return { data, error }
}

/**
 * Fetches audit logs for a playlist or track.
 */
export async function fetchTrackVerificationAuditLogs(params: {
  playlistId?: string
  trackId?: string
}): Promise<{
  data: Database['public']['Tables']['track_verification_audit_logs']['Row'][] | null
  error: Error | null
}> {
  let query = supabase
    .from('track_verification_audit_logs')
    .select('*')
    .order('created_at', { ascending: false })

  if (params.playlistId) {
    query = query.eq('playlist_id', params.playlistId)
  }
  if (params.trackId) {
    query = query.eq('track_id', params.trackId)
  }

  const { data, error } = await query
  return { data, error }
}

/**
 * Updates a playlist's title, description, and/or visibility in Supabase or local store.
 */
export async function updateSupabasePlaylist(params: {
  playlistId: string
  title?: string
  description?: string
  visibility?: Database['public']['Tables']['playlists']['Row']['visibility']
}): Promise<{ data: SupabasePlaylistRow | null; error: Error | null }> {
  if (params.title !== undefined) {
    const trimmed = params.title.trim()
    if (!trimmed) {
      return { data: null, error: new Error('Playlist title cannot be empty.') }
    }
    if (trimmed.length > 100) {
      return { data: null, error: new Error('Playlist title must not exceed 100 characters.') }
    }
  }

  if (params.description !== undefined) {
    const trimmed = params.description.trim()
    if (trimmed.length > 500) {
      return { data: null, error: new Error('Playlist description must not exceed 500 characters.') }
    }
  }

  // Check if target is a local playlist
  const localList = getLocalPlaylists()
  const foundLocalIndex = localList.findIndex((p) => p.id === params.playlistId)
  if (foundLocalIndex >= 0) {
    const existing = localList[foundLocalIndex]
    if (params.title !== undefined) existing.title = params.title.trim()
    if (params.description !== undefined) existing.description = params.description.trim() || null
    if (params.visibility !== undefined) existing.visibility = params.visibility
    existing.updated_at = new Date().toISOString()
    saveLocalPlaylist(existing)
    return { data: existing as unknown as SupabasePlaylistRow, error: null }
  }

  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) {
    return { data: null, error: new Error('Authentication required to update a playlist.') }
  }

  const payload: Partial<Database['public']['Tables']['playlists']['Update']> = {
    updated_at: new Date().toISOString(),
  }

  if (params.title !== undefined) {
    payload.title = params.title.trim()
  }

  if (params.description !== undefined) {
    payload.description = params.description.trim() || null
  }

  if (params.visibility !== undefined) {
    payload.visibility = params.visibility
  }

  const { data, error } = await supabase
    .from('playlists')
    .update(payload)
    .eq('id', params.playlistId)
    .select()
    .single()

  return { data, error }
}

/**
 * Deletes a playlist from Supabase or local store.
 */
export async function deleteSupabasePlaylist(
  playlistId: string,
): Promise<{ error: Error | null }> {
  // Check if target is a local playlist
  const localList = getLocalPlaylists()
  if (localList.some((p) => p.id === playlistId)) {
    deleteLocalPlaylist(playlistId)
    return { error: null }
  }

  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) {
    return { error: new Error('Authentication required to delete a playlist.') }
  }

  const { error } = await supabase
    .from('playlists')
    .delete()
    .eq('id', playlistId)

  return { error }
}

/**
 * Removes a track from a Supabase playlist or local store.
 */
export async function removeTrackFromPlaylist(params: {
  playlistId: string
  providerTrackId: string
}): Promise<{ error: Error | null }> {
  // Check if target is a local playlist
  const localTracks = getLocalPlaylistTracks(params.playlistId)
  const trackToRemove = localTracks.find((t) => t.provider_track_id === params.providerTrackId)
  if (trackToRemove) {
    removeLocalPlaylistTrack(trackToRemove.id)
    return { error: null }
  }

  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) {
    return { error: new Error('Authentication required to remove tracks.') }
  }

  const { error } = await supabase
    .from('playlist_tracks')
    .delete()
    .eq('playlist_id', params.playlistId)
    .eq('provider_track_id', params.providerTrackId)

  return { error }
}

/**
 * Removes/kicks a collaborator from a playlist (both server and Supabase).
 */
export async function kickCollaboratorFromPlaylist(params: {
  playlistId: string
  userId: string
}): Promise<{ error: Error | null }> {
  const { playlistId, userId } = params

  // 1. Remove from server registry
  try {
    if (typeof fetch === 'function') {
      await fetch('/api/playlists/collaborators', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistId, userId }),
      })
    }
  } catch {
    // Non-blocking
  }

  // 2. Remove from Supabase if configured
  if (isSupabaseConfigured()) {
    try {
      await supabase
        .from('playlist_members')
        .delete()
        .eq('playlist_id', playlistId)
        .eq('user_id', userId)
    } catch {
      // Non-blocking
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('orbim:playlist-updated', {
        detail: { playlistId, action: 'member_removed', userId },
      }),
    )
  }

  return { error: null }
}
