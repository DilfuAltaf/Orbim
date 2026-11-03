/**
 * Global Audio Registry & Cross-User Propagation Service.
 *
 * Implements:
 * - Centralized registry for admin-uploaded audio files across ORBIM.
 * - When platform administrator (dilfualtaf07@gmail.com) uploads audio for a track,
 *   that audio is globally registered by providerTrackId.
 * - Enriches search results (Explore, Search), playlist tracks, and recommendations
 *   so any user across the platform can stream and play the audio provided by admin.
 * - Strictly enforces that only admin can upload audio, while other users can stream/play.
 */

import { isSupabaseConfigured, supabase } from '../../lib/supabase.ts'
import type { MusicTrack } from '../../types/music.ts'
import { getKnownTrackMetadata } from '../../data/known-tracks.ts'
import { resolveStoragePublicUrl } from './audio-storage.ts'

export { resolveStoragePublicUrl }

export interface GlobalAudioRecord {
  providerTrackId: string
  storagePath: string
  audioUrl: string
  audioSourceType: 'storage' | 'direct_stream'
  title?: string
  artistName?: string
  albumName?: string
  artworkUrl?: string
  durationSeconds?: number
  updatedAt: string
}

const STORAGE_CACHE_KEY = 'orbim_global_audio_registry_v2'

// In-memory cache for fast, zero-latency synchronous lookups
const inMemoryAudioCache = new Map<string, GlobalAudioRecord>()

/**
 * Normalizes providerTrackId to ensure matching between raw Spotify IDs
 * and URI formats (e.g. "4cOdK2wGLETKBW3PvgPWqT" vs "spotify:track:4cOdK2wGLETKBW3PvgPWqT").
 */
export function normalizeTrackId(id: string | null | undefined): string {
  if (!id) return ''
  return id.trim().replace(/^spotify:track:/i, '').trim()
}

/**
 * Initializes cache from localStorage if available.
 */
function initFromLocalStorage(): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return

  try {
    const raw = window.localStorage.getItem(STORAGE_CACHE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, GlobalAudioRecord>
      for (const [key, value] of Object.entries(parsed)) {
        inMemoryAudioCache.set(key, value)
        const norm = normalizeTrackId(key)
        if (norm && norm !== key) {
          inMemoryAudioCache.set(norm, value)
        }
      }
    }
  } catch {
    // Silently continue if localStorage is restricted
  }
}

// Initial cache hydration
initFromLocalStorage()

/**
 * Returns all currently cached global audio records (de-duplicated by normalized ID).
 */
export function getAllCachedAudioRecords(): Record<string, GlobalAudioRecord> {
  const result: Record<string, GlobalAudioRecord> = {}
  for (const [key, value] of inMemoryAudioCache.entries()) {
    const norm = normalizeTrackId(key)
    if (norm && !result[norm]) {
      const known = getKnownTrackMetadata(norm)
      result[norm] = {
        ...value,
        title: value.title || known?.title,
        artistName: value.artistName || known?.artistName,
        albumName: value.albumName || known?.albumName,
        artworkUrl: value.artworkUrl || known?.artworkUrl,
        durationSeconds: value.durationSeconds || known?.durationSeconds,
      }
    }
  }
  return result
}

/**
 * Synchronizes the global audio registry from remote sources:
 * 1. Local/Vite streaming registry endpoint (/api/audio/registry)
 * 2. Supabase Database canonical catalog table (public.catalog_tracks where publication_status = 'published')
 *
 * Ensures that any user logging in on any browser gets the full list of admin-uploaded audio.
 */
let activeSyncPromise: Promise<void> | null = null

export async function syncGlobalAudioFromRemote(): Promise<void> {
  if (activeSyncPromise) return activeSyncPromise
  activeSyncPromise = doSyncGlobalAudioFromRemote().finally(() => {
    activeSyncPromise = null
  })
  return activeSyncPromise
}

async function doSyncGlobalAudioFromRemote(): Promise<void> {
  let hasNew = false

  // 1. Try local Vite server / range streaming registry endpoint
  try {
    const res = await fetch('/api/audio/registry', {
      headers: { Accept: 'application/json' },
    })
    if (res.ok) {
      const payload = (await res.json()) as Record<string, unknown>
      const rawRecords: Record<string, unknown> =
        payload && typeof payload === 'object' && 'records' in payload && payload.records && typeof payload.records === 'object'
          ? (payload.records as Record<string, unknown>)
          : payload

      const validServerKeys = new Set<string>()
      for (const val of Object.values(rawRecords)) {
        const rec = val as GlobalAudioRecord
        if (rec && typeof rec === 'object' && rec.providerTrackId && rec.audioUrl) {
          const norm = normalizeTrackId(rec.providerTrackId)
          validServerKeys.add(norm)
          validServerKeys.add(rec.providerTrackId)
          validServerKeys.add(`spotify:track:${norm}`)

          const existing = getCachedAudioRecord(rec.providerTrackId)
          if (!existing || existing.audioUrl !== rec.audioUrl || existing.storagePath !== rec.storagePath) {
            cacheGlobalAudioRecord(rec)
            hasNew = true
          }
        }
      }

      // Prune cached records that are no longer in server registry
      if (validServerKeys.size > 0) {
        for (const key of Array.from(inMemoryAudioCache.keys())) {
          const norm = normalizeTrackId(key)
          if (!validServerKeys.has(norm) && !validServerKeys.has(key)) {
            deleteCachedAudioRecord(key)
            hasNew = true
          }
        }
      }
    }
  } catch {
    // Non-blocking in offline / non-Vite environments
  }

  // 2. Sync from Supabase public.catalog_tracks (Canonical Source of Truth)
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('catalog_tracks')
        .select('provider_track_id, title, artist_name, storage_path, audio_url, audio_source_type, publication_status')
        .eq('publication_status', 'published')

      if (!error && data && data.length > 0) {
        for (const row of data) {
          const publicUrl =
            row.audio_url ||
            (row.storage_path ? resolveStoragePublicUrl(row.storage_path) : null)

          if (publicUrl && row.provider_track_id) {
            const existing = getCachedAudioRecord(row.provider_track_id)
            if (!existing || existing.audioUrl !== publicUrl || existing.storagePath !== row.storage_path) {
              cacheGlobalAudioRecord({
                providerTrackId: row.provider_track_id,
                storagePath: row.storage_path || '',
                audioUrl: publicUrl,
                audioSourceType: 'storage',
                title: row.title,
                artistName: row.artist_name,
                updatedAt: new Date().toISOString(),
              })
              hasNew = true
            }
          }
        }
      }
    } catch {
      // Non-blocking
    }
  }

  if (hasNew && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('orbim:audio-updated', { detail: {} }))
  }
}

// Background initial sync for browser clients
if (typeof window !== 'undefined') {
  void syncGlobalAudioFromRemote()
}

/**
 * Saves a global audio record to cache and local storage.
 */
export function cacheGlobalAudioRecord(record: GlobalAudioRecord): void {
  const normKey = normalizeTrackId(record.providerTrackId)
  inMemoryAudioCache.set(record.providerTrackId, record)
  if (normKey) {
    inMemoryAudioCache.set(normKey, record)
  }

  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      const existingRaw = window.localStorage.getItem(STORAGE_CACHE_KEY)
      const existing = existingRaw ? (JSON.parse(existingRaw) as Record<string, GlobalAudioRecord>) : {}
      existing[record.providerTrackId] = record
      if (normKey) {
        existing[normKey] = record
      }
      window.localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(existing))
    } catch {
      // Ignore quota or private mode errors
    }
  }
}

/**
 * Checks in-memory cache for existing audio metadata.
 */
export function getCachedAudioRecord(providerTrackId: string | null | undefined): GlobalAudioRecord | null {
  if (!providerTrackId) return null
  const direct = inMemoryAudioCache.get(providerTrackId)
  if (direct) return direct
  const norm = normalizeTrackId(providerTrackId)
  return inMemoryAudioCache.get(norm) || null
}

/**
 * Removes an audio record from in-memory cache and localStorage (e.g. when unpublished).
 */
export function deleteCachedAudioRecord(providerTrackId: string): void {
  if (!providerTrackId) return
  const norm = normalizeTrackId(providerTrackId)
  const uriId = `spotify:track:${norm}`

  inMemoryAudioCache.delete(providerTrackId)
  if (norm) {
    inMemoryAudioCache.delete(norm)
  }
  if (uriId) {
    inMemoryAudioCache.delete(uriId)
  }

  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      const existingRaw = window.localStorage.getItem(STORAGE_CACHE_KEY)
      if (existingRaw) {
        const existing = JSON.parse(existingRaw) as Record<string, GlobalAudioRecord>
        delete existing[providerTrackId]
        if (norm) {
          delete existing[norm]
        }
        if (uriId) {
          delete existing[uriId]
        }
        window.localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(existing))
      }
    } catch {
      // Ignore
    }
  }

  // Notify dev/local streaming server registry
  try {
    if (typeof fetch === 'function') {
      void fetch(`/api/audio/registry?providerTrackId=${encodeURIComponent(norm || providerTrackId)}`, {
        method: 'DELETE',
      }).catch(() => null)
    }
  } catch {
    // Non-blocking
  }
}

/**
 * Propagates an uploaded audio file across the entire database and notifies all clients.
 * Updates all rows in playlist_tracks that share this provider_track_id so any playlist
 * containing this track receives the audio immediately.
 */
export async function propagateTrackAudioGlobally(params: {
  providerTrackId: string
  storagePath: string
  audioUrl: string
  title?: string
  artistName?: string
}): Promise<void> {
  const { providerTrackId, storagePath, audioUrl, title, artistName } = params

  if (!providerTrackId || !storagePath || !audioUrl) return

  // 1. Update cache immediately
  const record: GlobalAudioRecord = {
    providerTrackId,
    storagePath,
    audioUrl,
    audioSourceType: 'storage',
    title,
    artistName,
    updatedAt: new Date().toISOString(),
  }
  cacheGlobalAudioRecord(record)

  // 2. Persist record to local/dev server registry endpoint
  try {
    if (typeof fetch === 'function') {
      void fetch('/api/audio/registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      }).catch(() => null)
    }
  } catch {
    // Non-blocking
  }

  // 4. Propagate to all rows in Supabase database with matching provider_track_id
  const normId = normalizeTrackId(providerTrackId)
  const idsToUpdate = Array.from(new Set([providerTrackId, normId, `spotify:track:${normId}`])).filter(Boolean)

  try {
    for (const id of idsToUpdate) {
      await supabase
        .from('playlist_tracks')
        .update({
          audio_source_type: 'storage',
          storage_path: storagePath,
          audio_url: audioUrl,
        })
        .eq('provider_track_id', id)
    }
  } catch {
    // Non-blocking: database update failures do not prevent client playback
  }

  // 5. Dispatch global custom events so UI across tabs or surfaces reacts
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(
      new CustomEvent('orbim:audio-updated', {
        detail: { providerTrackId, storagePath, audioUrl },
      }),
    )
    window.dispatchEvent(new CustomEvent('orbim:playlist-updated', { detail: {} }))
  }
}

/**
 * Finds global audio for a track by checking in-memory cache and Supabase database.
 */
export async function findGlobalAudioForTrack(
  providerTrackId: string,
): Promise<GlobalAudioRecord | null> {
  if (!providerTrackId) return null

  // 1. Check cache first
  const cached = getCachedAudioRecord(providerTrackId)
  if (cached) return cached

  // 2. Query Supabase catalog_tracks for published audio for this track
  const normId = normalizeTrackId(providerTrackId)
  const candidateIds = Array.from(new Set([providerTrackId, normId, `spotify:track:${normId}`])).filter(Boolean)

  if (isSupabaseConfigured()) {
    try {
      const { data: catData } = await supabase
        .from('catalog_tracks')
        .select('provider_track_id, audio_url, storage_path, audio_source_type, title, artist_name')
        .in('provider_track_id', candidateIds)
        .eq('publication_status', 'published')
        .limit(1)
        .maybeSingle()

      if (catData && (catData.audio_url || catData.storage_path)) {
        const publicUrl =
          catData.audio_url ||
          (catData.storage_path ? resolveStoragePublicUrl(catData.storage_path) : null)

        if (publicUrl) {
          const record: GlobalAudioRecord = {
            providerTrackId,
            storagePath: catData.storage_path || '',
            audioUrl: publicUrl,
            audioSourceType: 'storage',
            title: catData.title,
            artistName: catData.artist_name,
            updatedAt: new Date().toISOString(),
          }
          cacheGlobalAudioRecord(record)
          return record
        }
      }
    } catch {
      // Silently fallback to playlist_tracks
    }
  }

  // 3. Fallback: Query Supabase playlist_tracks for backward compatibility
  try {
    const { data } = await supabase
      .from('playlist_tracks')
      .select('provider_track_id, audio_url, storage_path, audio_source_type, title, artist_name')
      .in('provider_track_id', candidateIds)
      .or('storage_path.not.is.null,audio_url.not.is.null')
      .limit(1)
      .maybeSingle()

    if (data && (data.audio_url || data.storage_path)) {
      const publicUrl =
        data.audio_url ||
        (data.storage_path ? resolveStoragePublicUrl(data.storage_path) : null)

      if (publicUrl) {
        const record: GlobalAudioRecord = {
          providerTrackId,
          storagePath: data.storage_path || '',
          audioUrl: publicUrl,
          audioSourceType: 'storage',
          title: data.title,
          artistName: data.artist_name,
          updatedAt: new Date().toISOString(),
        }
        cacheGlobalAudioRecord(record)
        return record
      }
    }
  } catch {
    // Silently fallback to null
  }

  return null
}

/**
 * Enriches an array of tracks (e.g. from Spotify catalog search or mock listings)
 * with admin-uploaded audio from Supabase or cache.
 * Tracks that match uploaded audio become isPlayable: true with direct HTML5 playbackUrl.
 */
export async function enrichTracksWithGlobalAudio(
  tracks: MusicTrack[],
): Promise<MusicTrack[]> {
  if (!tracks || tracks.length === 0) return []

  // Ensure remote registry is synced if in-memory cache is empty
  if (inMemoryAudioCache.size === 0) {
    await syncGlobalAudioFromRemote()
  }

  // Check which tracks are missing in cache
  const missingIds = tracks
    .map((t) => t.providerTrackId || t.id)
    .filter((id): id is string => Boolean(id && !getCachedAudioRecord(id)))

  // Query database in batch if any IDs are missing in cache and Supabase is configured
  if (missingIds.length > 0) {
    let hasClient = false
    try {
      hasClient = isSupabaseConfigured()
    } catch {
      hasClient = false
    }

    if (hasClient) {
      const expandedIds = new Set<string>()
      for (const id of missingIds) {
        expandedIds.add(id)
        const norm = normalizeTrackId(id)
        if (norm) {
          expandedIds.add(norm)
          expandedIds.add(`spotify:track:${norm}`)
        }
      }

      try {
        // First batch query public.catalog_tracks for published audio
        const { data: catData } = await supabase
          .from('catalog_tracks')
          .select('provider_track_id, audio_url, storage_path, audio_source_type, title, artist_name')
          .in('provider_track_id', Array.from(expandedIds))
          .eq('publication_status', 'published')

        if (catData && catData.length > 0) {
          for (const row of catData) {
            const publicUrl =
              row.audio_url ||
              (row.storage_path ? resolveStoragePublicUrl(row.storage_path) : null)

            if (publicUrl && row.provider_track_id) {
              cacheGlobalAudioRecord({
                providerTrackId: row.provider_track_id,
                storagePath: row.storage_path || '',
                audioUrl: publicUrl,
                audioSourceType: 'storage',
                title: row.title,
                artistName: row.artist_name,
                updatedAt: new Date().toISOString(),
              })
            }
          }
        }

        // Second fallback batch query playlist_tracks for backward compatibility
        const { data } = await supabase
          .from('playlist_tracks')
          .select('provider_track_id, audio_url, storage_path, audio_source_type, title, artist_name')
          .in('provider_track_id', Array.from(expandedIds))
          .or('storage_path.not.is.null,audio_url.not.is.null')

        if (data && data.length > 0) {
          for (const row of data) {
            const publicUrl =
              row.audio_url ||
              (row.storage_path ? resolveStoragePublicUrl(row.storage_path) : null)

            if (publicUrl && row.provider_track_id && !getCachedAudioRecord(row.provider_track_id)) {
              cacheGlobalAudioRecord({
                providerTrackId: row.provider_track_id,
                storagePath: row.storage_path || '',
                audioUrl: publicUrl,
                audioSourceType: 'storage',
                title: row.title,
                artistName: row.artist_name,
                updatedAt: new Date().toISOString(),
              })
            }
          }
        }
      } catch {
        // Non-blocking: continue with available cached records
      }
    }
  }

  // Map each track against cached records and resolve directly to Supabase Storage
  return tracks.map((track) => resolveEffectiveTrack(track) || track)
}

/**
 * Resolves a track to its playable audio representation and enriches missing metadata.
 * Guarantees that audio URLs and high-resolution artworks are loaded reliably.
 */
export function resolveEffectiveTrack(track: MusicTrack | null | undefined): MusicTrack | null {
  if (!track) return null

  const normId = normalizeTrackId(track.providerTrackId || track.id)
  const cached =
    (track.providerTrackId && getCachedAudioRecord(track.providerTrackId)) ||
    (normId && getCachedAudioRecord(normId)) ||
    (track.id && getCachedAudioRecord(track.id)) ||
    null

  const known = getKnownTrackMetadata(track.providerTrackId || normId)

  const effectiveArtworkUrl = track.artworkUrl || cached?.artworkUrl || known?.artworkUrl
  const effectiveAlbumName = track.albumName || cached?.albumName || known?.albumName
  const effectiveTitle = track.title || cached?.title || known?.title || 'Unknown Title'
  const effectiveArtist = track.artistName || cached?.artistName || known?.artistName || 'Unknown Artist'
  const effectiveDuration = track.durationSeconds || cached?.durationSeconds || known?.durationSeconds || 0

  const storagePath = track.storagePath || cached?.storagePath

  let resolvedUrl: string | undefined = undefined

  // 1. Direct candidate: If cached record or track has an HTTP URL or relative audio path, use it directly
  const candidate = cached?.audioUrl || track.playbackUrl || track.audioSourceUrl
  if (candidate && (candidate.startsWith('http') || candidate.startsWith('/'))) {
    resolvedUrl = candidate
  }

  // 2. If storagePath exists and no direct HTTP URL yet, derive the Supabase Storage CDN URL
  if (!resolvedUrl && storagePath) {
    resolvedUrl = resolveStoragePublicUrl(storagePath)
  }

  if (resolvedUrl) {
    return {
      ...track,
      title: effectiveTitle,
      artistName: effectiveArtist,
      albumName: effectiveAlbumName,
      artworkUrl: effectiveArtworkUrl || track.artworkUrl,
      durationSeconds: effectiveDuration,
      isPlayable: true,
      playbackUrl: resolvedUrl,
      audioSourceUrl: resolvedUrl,
      storagePath: storagePath || track.storagePath || cached?.storagePath,
      audioSourceType: (cached?.audioSourceType || track.audioSourceType || 'storage') as any,
    }
  }

  if (effectiveArtworkUrl || effectiveAlbumName) {
    return {
      ...track,
      title: effectiveTitle,
      artistName: effectiveArtist,
      albumName: effectiveAlbumName || track.albumName,
      artworkUrl: effectiveArtworkUrl || track.artworkUrl,
      durationSeconds: effectiveDuration,
    }
  }

  return track
}
