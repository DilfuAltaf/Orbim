/**
 * Canonical Global Music Catalog & Publication Workflow Service.
 *
 * Implements ORBIM Product & Security Rules:
 * 1. Only designated ORBIM admin (dilfualtaf07@gmail.com) can upload audio and publish tracks.
 * 2. Uploads audio directly to Supabase Storage bucket 'track-audio'.
 * 3. Canonical global catalog is stored in public.catalog_tracks, strictly separated from playlist membership.
 * 4. Strict Published-Only Visibility: Regular users can ONLY query, see, and play 'published' tracks.
 *    Drafts, pending, and unpublished tracks are strictly hidden from regular users at both RLS and service level.
 * 5. Playlist entries reference the canonical catalogTrackId and never duplicate the audio file.
 */

import { isUserAdmin } from '../../features/auth/admin.ts'
import { isSupabaseConfigured, supabase } from '../../lib/supabase.ts'
import type { Database } from '../../types/database.ts'
import type { AudioSourceType, MusicTrack, PublicationStatus } from '../../types/music.ts'
import { getKnownTrackMetadata } from '../../data/known-tracks.ts'
import { selectRecentlyAddedTracks } from './recently-added.ts'
import {
  DEFAULT_AUDIO_BUCKET,
  validateAudioFileMetadata,
  MAX_AUDIO_FILE_SIZE_BYTES,
  MIN_AUDIO_FILE_SIZE_BYTES,
  SUPPORTED_AUDIO_EXTENSIONS,
  resolveStoragePublicUrl,
} from '../audio/audio-storage.ts'
import {
  cacheGlobalAudioRecord,
  deleteCachedAudioRecord,
  getAllCachedAudioRecords,
  getCachedAudioRecord,
  normalizeTrackId,
  propagateTrackAudioGlobally,
  resolveEffectiveTrack,
} from '../audio/global-audio-registry.ts'

export interface CatalogTrackRecord {
  id: string
  provider: 'spotify' | 'orbim' | 'custom'
  providerTrackId: string
  title: string
  artistName: string
  albumName?: string | null
  artworkUrl?: string | null
  durationSeconds: number
  storagePath?: string | null
  audioUrl?: string | null
  audioSourceType: AudioSourceType
  publicationStatus: PublicationStatus
  createdBy?: string | null
  createdAt: string
  updatedAt: string
  publishedAt?: string | null
  publishedBy?: string | null
}

// In-memory catalog state for instant local/offline reactivity
const inMemoryCatalog = new Map<string, CatalogTrackRecord>()

/**
 * Returns strictly unique catalog records from in-memory catalog,
 * preventing duplicated entries caused by dual keying (UUID + providerTrackId).
 */
export function getUniqueCatalogValues(): CatalogTrackRecord[] {
  const map = new Map<string, CatalogTrackRecord>()
  for (const r of inMemoryCatalog.values()) {
    const key = normalizeTrackId(r.providerTrackId) || r.id
    if (key && !map.has(key)) {
      map.set(key, r)
    }
  }
  return Array.from(map.values())
}

/**
 * Validates audio file constraints before attempting upload.
 */
export function validateCatalogAudioFile(
  file: File | Blob,
  fileNameOverride?: string,
): { valid: boolean; error?: string; extension?: string; mimeType?: string } {
  const name = fileNameOverride || (file instanceof File ? file.name : 'audio.mp3')
  const validation = validateAudioFileMetadata({
    fileName: name,
    sizeBytes: file.size,
    maxSizeBytes: MAX_AUDIO_FILE_SIZE_BYTES,
  })

  if (!validation.valid) {
    return { valid: false, error: validation.error || 'Invalid audio file.' }
  }

  if (file.size < MIN_AUDIO_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `Audio file is too small (minimum ${MIN_AUDIO_FILE_SIZE_BYTES} bytes required).`,
    }
  }

  const clean = name.trim().toLowerCase()
  const dotIdx = clean.lastIndexOf('.')
  const ext = dotIdx !== -1 ? clean.substring(dotIdx) : '.mp3'
  const mimeType = SUPPORTED_AUDIO_EXTENSIONS[ext] || 'audio/mpeg'

  return { valid: true, extension: ext, mimeType }
}

/**
 * Maps a catalog record to standard MusicTrack.
 */
export function mapCatalogRecordToMusicTrack(record: CatalogTrackRecord): MusicTrack {
  const normId = normalizeTrackId(record.providerTrackId || record.id)
  const known = getKnownTrackMetadata(normId) || getKnownTrackMetadata(record.providerTrackId)
  const effectiveAudioUrl =
    record.audioUrl || (record.storagePath ? resolveStoragePublicUrl(record.storagePath) : undefined)
  const isPlayable = record.publicationStatus === 'published' && Boolean(effectiveAudioUrl || record.storagePath)

  return {
    id: record.id,
    catalogTrackId: record.id,
    provider: record.provider,
    providerTrackId: record.providerTrackId,
    title: record.title || known?.title || 'Unknown Title',
    artistName: record.artistName || known?.artistName || 'Unknown Artist',
    albumName: record.albumName || known?.albumName || undefined,
    artworkUrl: record.artworkUrl || known?.artworkUrl || undefined,
    durationSeconds: record.durationSeconds || known?.durationSeconds || 0,
    genre: 'Catalog',
    moods: [],
    isPlayable,
    playbackUrl: isPlayable ? effectiveAudioUrl : undefined,
    audioSourceUrl: isPlayable ? effectiveAudioUrl : undefined,
    storagePath: record.storagePath || undefined,
    audioSourceType: isPlayable ? (record.audioSourceType === 'none' ? 'storage' : record.audioSourceType) : 'none',
    publicationStatus: record.publicationStatus,
    publishedAt: record.publishedAt,
    publishedBy: record.publishedBy,
    addedVia: 'system',
  }
}

/**
 * Fetches published tracks from the global music catalog.
 * Regular users ONLY ever see and receive tracks where publication_status = 'published'
 * AND confirmed playable audio is present.
 * Drafts, unpublished, pending uploads, and tracks without audio are strictly hidden.
 */
export async function fetchPublishedCatalogTracks(options: {
  searchQuery?: string
  genre?: string | null
} = {}): Promise<MusicTrack[]> {
  const { searchQuery } = options

  let records: CatalogTrackRecord[] = []

  // 1. Try querying Supabase public.catalog_tracks table
  if (isSupabaseConfigured()) {
    try {
      let query = supabase
        .from('catalog_tracks')
        .select('*')
        .eq('publication_status', 'published')
        .order('published_at', { ascending: false })

      if (searchQuery && searchQuery.trim().length > 0) {
        query = query.or(`title.ilike.%${searchQuery.trim()}%,artist_name.ilike.%${searchQuery.trim()}%`)
      }

      const { data, error } = await query

      if (!error && data && data.length > 0) {
        records = data
          .filter((row) => {
            const hasPath = typeof row.storage_path === 'string' && row.storage_path.trim().length > 0
            const hasUrl = typeof row.audio_url === 'string' && row.audio_url.trim().length > 0
            return hasPath || hasUrl
          })
          .map((row) => mapCatalogRowToRecord(row))

        // Update in-memory cache and global audio registry directly
        for (const r of records) {
          const normId = normalizeTrackId(r.providerTrackId)
          inMemoryCatalog.set(r.id, r)
          if (normId) {
            inMemoryCatalog.set(normId, r)
          }
          const effectiveAudioUrl =
            r.audioUrl || (r.storagePath ? resolveStoragePublicUrl(r.storagePath) : null)
          if (effectiveAudioUrl && r.providerTrackId) {
            cacheGlobalAudioRecord({
              providerTrackId: r.providerTrackId,
              storagePath: r.storagePath || '',
              audioUrl: effectiveAudioUrl,
              audioSourceType: 'storage',
              title: r.title,
              artistName: r.artistName,
              albumName: r.albumName || undefined,
              artworkUrl: r.artworkUrl || undefined,
              durationSeconds: r.durationSeconds,
              updatedAt: r.updatedAt,
            })
          }
        }
      }
    } catch {
      // Table may be awaiting migration; fallback seamlessly to published memory/registry
    }
  }

  // 2. Fallback to inMemoryCatalog + global audio registry records
  if (records.length === 0) {
    const cachedRecords = getAllCachedAudioRecords()
    const validNormIds = new Set(Object.keys(cachedRecords).map((k) => normalizeTrackId(k)))

    // Prune stale inMemoryCatalog items that are not in the active audio registry
    for (const r of getUniqueCatalogValues()) {
      const norm = normalizeTrackId(r.providerTrackId || r.id)
      if (!validNormIds.has(norm)) {
        inMemoryCatalog.delete(r.id)
        if (r.providerTrackId) inMemoryCatalog.delete(r.providerTrackId)
        if (norm) inMemoryCatalog.delete(norm)
      }
    }

    const memoryPublished = getUniqueCatalogValues().filter(
      (r) =>
        r.publicationStatus === 'published' &&
        validNormIds.has(normalizeTrackId(r.providerTrackId || r.id)),
    )

    if (memoryPublished.length > 0) {
      records = memoryPublished
    } else {
      // Seed strictly from active published audio records in registry that have confirmed audio
      const seenIds = new Set<string>()

      for (const [trackId, cached] of Object.entries(cachedRecords)) {
        const normId = normalizeTrackId(trackId)
        if (!normId || seenIds.has(normId)) continue
        seenIds.add(normId)

        if (cached && (cached.audioUrl || cached.storagePath)) {
          const known = getKnownTrackMetadata(normId)
          const rec: CatalogTrackRecord = {
            id: crypto.randomUUID(),
            provider: 'spotify',
            providerTrackId: normId,
            title: cached.title || known?.title || 'Unknown Title',
            artistName: cached.artistName || known?.artistName || 'Unknown Artist',
            albumName: cached.albumName || known?.albumName || null,
            artworkUrl: cached.artworkUrl || known?.artworkUrl || null,
            durationSeconds: cached.durationSeconds || known?.durationSeconds || 240,
            storagePath: cached.storagePath,
            audioUrl: cached.audioUrl,
            audioSourceType: cached.audioSourceType || 'storage',
            publicationStatus: 'published',
            createdAt: cached.updatedAt || new Date().toISOString(),
            updatedAt: cached.updatedAt || new Date().toISOString(),
            publishedAt: cached.updatedAt || new Date().toISOString(),
          }
          inMemoryCatalog.set(normId, rec)
          records.push(rec)
        }
      }
    }
  }

  // Strictly de-duplicate records by normalized providerTrackId
  const uniqueRecordsMap = new Map<string, CatalogTrackRecord>()
  for (const r of records) {
    const norm = normalizeTrackId(r.providerTrackId || r.id)
    if (norm && !uniqueRecordsMap.has(norm)) {
      uniqueRecordsMap.set(norm, r)
    }
  }
  records = Array.from(uniqueRecordsMap.values())

  // Filter by search query if provided
  if (searchQuery && searchQuery.trim().length > 0) {
    const q = searchQuery.toLowerCase().trim()
    records = records.filter(
      (r) => r.title.toLowerCase().includes(q) || r.artistName.toLowerCase().includes(q),
    )
  }

  const tracks = records.map((r) => {
    const track = mapCatalogRecordToMusicTrack(r)
    return resolveEffectiveTrack(track) || track
  })

  // CRITICAL: Strictly ensure songs without audio are NEVER returned in the published catalog!
  const seenTracks = new Set<string>()
  const finalTracks: MusicTrack[] = []

  for (const track of tracks) {
    const norm = normalizeTrackId(track.providerTrackId || track.id)
    if (!norm || seenTracks.has(norm)) continue

    if (!track.isPlayable) continue
    const hasAudio = Boolean(
      (typeof track.storagePath === 'string' && track.storagePath.trim().length > 0) ||
      (typeof track.playbackUrl === 'string' && track.playbackUrl.trim().length > 0) ||
      (typeof track.audioSourceUrl === 'string' && track.audioSourceUrl.trim().length > 0) ||
      getCachedAudioRecord(track.providerTrackId),
    )
    if (!hasAudio) continue

    seenTracks.add(norm)
    finalTracks.push(track)
  }

  return finalTracks
}

type CatalogTrackRow = Database['public']['Tables']['catalog_tracks']['Row']

function mapCatalogRowToRecord(row: CatalogTrackRow): CatalogTrackRecord {
  const effectiveAudioUrl =
    row.audio_url || (row.storage_path ? resolveStoragePublicUrl(row.storage_path) : null)
  const normId = normalizeTrackId(row.provider_track_id)
  const known = getKnownTrackMetadata(normId) || getKnownTrackMetadata(row.provider_track_id)

  return {
    id: row.id,
    provider: (row.provider || 'spotify') as CatalogTrackRecord['provider'],
    providerTrackId: row.provider_track_id,
    title: row.title || known?.title || 'Unknown Title',
    artistName: row.artist_name || known?.artistName || 'Unknown Artist',
    albumName: row.album_name || known?.albumName || null,
    artworkUrl: row.artwork_url || known?.artworkUrl || null,
    durationSeconds: row.duration_seconds || known?.durationSeconds || 0,
    storagePath: row.storage_path,
    audioUrl: effectiveAudioUrl,
    audioSourceType: (row.audio_source_type || 'storage') as AudioSourceType,
    publicationStatus: row.publication_status as PublicationStatus,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
  }
}

/**
 * Fetches the newest published catalog tracks that actually carry stored audio.
 *
 * This is the ONLY source for the Home "Recently Added" section: drafts,
 * unpublished records, metadata-only entries and failed uploads are excluded
 * both by the query (published + storage_path present) and by the shared
 * eligibility filter, and ordering uses the real publication timestamp.
 */
export async function fetchRecentlyAddedCatalogTracks(
  options: { limit?: number; offset?: number } = {},
): Promise<{ tracks: MusicTrack[]; hasMore: boolean }> {
  const { limit = 6, offset = 0 } = options

  if (!isSupabaseConfigured()) {
    return { tracks: [], hasMore: false }
  }

  try {
    const { data, error } = await supabase
      .from('catalog_tracks')
      .select('*')
      .eq('publication_status', 'published')
      .not('storage_path', 'is', null)
      .order('published_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + Math.max(limit, 1) - 1)

    if (error || !data) {
      return { tracks: [], hasMore: false }
    }

    const tracks = data.map((row) => {
      const mapped = mapCatalogRecordToMusicTrack(mapCatalogRowToRecord(row))
      return resolveEffectiveTrack(mapped) || mapped
    })

    return {
      tracks: selectRecentlyAddedTracks(tracks, { limit }),
      hasMore: data.length === limit,
    }
  } catch {
    return { tracks: [], hasMore: false }
  }
}

/**
 * Fetches admin catalog view, allowing filtering by draft, published, or unpublished status.
 * Strictly forbidden to non-admin users.
 */
export async function fetchAdminCatalogTracks(options: {
  userEmail?: string | null
  status?: PublicationStatus | 'all'
}): Promise<CatalogTrackRecord[]> {
  const { userEmail, status = 'all' } = options

  if (!isUserAdmin(userEmail)) {
    throw new Error('Access denied: only platform administrators can inspect catalog drafts and management states.')
  }

  if (isSupabaseConfigured()) {
    try {
      let query = supabase.from('catalog_tracks').select('*').order('created_at', { ascending: false })

      if (status !== 'all') {
        query = query.eq('publication_status', status)
      }

      const { data, error } = await query
      if (!error && data) {
        return data.map((row) => ({
          id: row.id,
          provider: (row.provider || 'spotify') as 'spotify',
          providerTrackId: row.provider_track_id,
          title: row.title,
          artistName: row.artist_name,
          albumName: row.album_name,
          artworkUrl: row.artwork_url,
          durationSeconds: row.duration_seconds || 0,
          storagePath: row.storage_path,
          audioUrl: row.audio_url,
          audioSourceType: (row.audio_source_type || 'storage') as AudioSourceType,
          publicationStatus: row.publication_status as PublicationStatus,
          createdBy: row.created_by,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          publishedAt: row.published_at,
          publishedBy: row.published_by,
        }))
      }
    } catch {
      // Non-blocking fallback to inMemory
    }
  }

  const all = getUniqueCatalogValues()
  if (status === 'all') return all
  return all.filter((r) => r.publicationStatus === status)
}

/**
 * Creates a new draft track in the global music catalog.
 * Strictly restricted to Platform Administrators.
 */
export async function createDraftCatalogTrack(params: {
  userEmail?: string | null
  userId?: string | null
  track: MusicTrack
}): Promise<CatalogTrackRecord> {
  const { userEmail, userId, track } = params

  if (!isUserAdmin(userEmail)) {
    throw new Error('Hanya akun administrator (dilfualtaf07@gmail.com) yang diizinkan membuat draft lagu di katalog.')
  }

  const record: CatalogTrackRecord = {
    id: crypto.randomUUID(),
    provider: (track.provider === 'spotify' ? 'spotify' : 'orbim') as 'spotify',
    providerTrackId: track.providerTrackId || crypto.randomUUID(),
    title: track.title,
    artistName: track.artistName,
    albumName: track.albumName || null,
    artworkUrl: track.artworkUrl || null,
    durationSeconds: track.durationSeconds || 0,
    storagePath: null,
    audioUrl: null,
    audioSourceType: 'none',
    publicationStatus: 'draft',
    createdBy: userId || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    publishedAt: null,
    publishedBy: null,
  }

  inMemoryCatalog.set(record.id, record)
  inMemoryCatalog.set(normalizeTrackId(record.providerTrackId), record)

  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('catalog_tracks')
        .upsert(
          {
            provider: record.provider,
            provider_track_id: record.providerTrackId,
            title: record.title,
            artist_name: record.artistName,
            album_name: record.albumName,
            artwork_url: record.artworkUrl,
            duration_seconds: record.durationSeconds,
            storage_path: null,
            audio_url: null,
            audio_source_type: 'none',
            publication_status: 'draft',
            created_by: userId || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'provider,provider_track_id' },
        )
        .select()
        .single()

      if (!error && data) {
        record.id = data.id
      }
    } catch {
      // Non-blocking
    }
  }

  return record
}

/**
 * Uploads audio to Supabase Storage bucket 'track-audio' and publishes the track to the global catalog.
 * Strictly restricted to Platform Administrators.
 * Once published, all users across ORBIM can discover and play it.
 */
export async function uploadAndPublishCatalogTrack(params: {
  userEmail?: string | null
  userId?: string | null
  track: MusicTrack
  audioFile: File | Blob
  fileName?: string
  bucketName?: string
}): Promise<{ success: boolean; catalogTrack?: CatalogTrackRecord; error?: Error }> {
  const { userEmail, userId, track, audioFile, fileName, bucketName = DEFAULT_AUDIO_BUCKET } = params

  // 1. Authorize admin
  if (!isUserAdmin(userEmail)) {
    return {
      success: false,
      error: new Error('Hanya akun administrator (dilfualtaf07@gmail.com) yang diizinkan mengunggah file audio dan mempublikasikan lagu.'),
    }
  }

  // 2. Validate audio file
  const effectiveFileName = fileName || (audioFile instanceof File ? audioFile.name : 'audio.mp3')
  const validation = validateCatalogAudioFile(audioFile, effectiveFileName)
  if (!validation.valid || !validation.extension || !validation.mimeType) {
    return {
      success: false,
      error: new Error(validation.error || 'Validasi file audio gagal.'),
    }
  }

  // 3. Resolve canonical storage folder UUID adhering to Supabase Storage RLS
  let folderUuid = '96e20d19-6a61-4938-b765-b226e9f2ccbb'
  if (isSupabaseConfigured() && userId) {
    try {
      const { data: userPlaylists } = await supabase
        .from('playlists')
        .select('id')
        .eq('owner_id', userId)
        .order('created_at', { ascending: true })
        .limit(1)

      if (userPlaylists && userPlaylists.length > 0 && userPlaylists[0].id) {
        folderUuid = userPlaylists[0].id
      }
    } catch {
      // Fallback to shared folder UUID
    }
  }

  const trackUuid = crypto.randomUUID()
  const storagePath = `${folderUuid}/${trackUuid}${validation.extension}`

  // 4. Upload directly to Supabase Storage
  if (isSupabaseConfigured()) {
    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(storagePath, audioFile, {
        contentType: validation.mimeType,
        upsert: true,
      })

    if (uploadError) {
      return {
        success: false,
        error: new Error(`Gagal mengunggah file audio ke Supabase Storage: ${uploadError.message}`),
      }
    }
  }

  // 5. Get canonical public CDN URL from Supabase Storage
  let audioPlaybackUrl = `https://rprrvdyugakkpittzvjv.supabase.co/storage/v1/object/public/track-audio/${storagePath}`
  if (isSupabaseConfigured()) {
    const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(storagePath)
    if (urlData?.publicUrl) {
      audioPlaybackUrl = urlData.publicUrl
    }
  }

  const now = new Date().toISOString()
  const canonicalRecord: CatalogTrackRecord = {
    id: crypto.randomUUID(),
    provider: (track.provider === 'spotify' ? 'spotify' : 'orbim') as 'spotify',
    providerTrackId: track.providerTrackId || crypto.randomUUID(),
    title: track.title,
    artistName: track.artistName,
    albumName: track.albumName || null,
    artworkUrl: track.artworkUrl || null,
    durationSeconds: track.durationSeconds || 0,
    storagePath,
    audioUrl: audioPlaybackUrl,
    audioSourceType: 'storage',
    publicationStatus: 'published',
    createdBy: userId || null,
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
    publishedBy: userId || null,
  }

  // Update in-memory state
  inMemoryCatalog.set(canonicalRecord.id, canonicalRecord)
  inMemoryCatalog.set(normalizeTrackId(canonicalRecord.providerTrackId), canonicalRecord)

  // 6. Persist to database if available
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('catalog_tracks')
        .upsert(
          {
            provider: canonicalRecord.provider,
            provider_track_id: canonicalRecord.providerTrackId,
            title: canonicalRecord.title,
            artist_name: canonicalRecord.artistName,
            album_name: canonicalRecord.albumName,
            artwork_url: canonicalRecord.artworkUrl,
            duration_seconds: canonicalRecord.durationSeconds,
            storage_path: storagePath,
            audio_url: audioPlaybackUrl,
            audio_source_type: 'storage',
            publication_status: 'published',
            published_at: now,
            published_by: userId || null,
            updated_at: now,
          },
          { onConflict: 'provider,provider_track_id' },
        )
        .select()
        .single()

      if (!error && data) {
        canonicalRecord.id = data.id
      }
    } catch {
      // Non-blocking
    }
  }

  // 7. Globally register and propagate uploaded audio for this track across all users
  await propagateTrackAudioGlobally({
    providerTrackId: canonicalRecord.providerTrackId,
    storagePath,
    audioUrl: audioPlaybackUrl,
    title: canonicalRecord.title,
    artistName: canonicalRecord.artistName,
  })

  // 8. Dispatch notification event
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(
      new CustomEvent('orbim:catalog-published', {
        detail: { trackId: canonicalRecord.id, providerTrackId: canonicalRecord.providerTrackId },
      }),
    )
  }

  return {
    success: true,
    catalogTrack: canonicalRecord,
  }
}

/**
 * Completely removes audio from a catalog track and deletes it from publication.
 * Reverts the track strictly back to pure Spotify metadata (no audio, unpublished).
 * Strictly restricted to Platform Administrators.
 */
export async function deleteCatalogTrackAudio(params: {
  trackId?: string
  providerTrackId?: string
  storagePath?: string | null
  userEmail?: string | null
  bucketName?: string
}): Promise<{ success: boolean; error?: Error }> {
  const {
    trackId,
    providerTrackId,
    storagePath: inputStoragePath,
    userEmail,
    bucketName = DEFAULT_AUDIO_BUCKET,
  } = params

  if (!isUserAdmin(userEmail)) {
    return {
      success: false,
      error: new Error('Hanya akun administrator (dilfualtaf07@gmail.com) yang diizinkan menghapus file audio.'),
    }
  }

  // Find record in memory to extract full identifiers
  let rec: CatalogTrackRecord | undefined
  if (trackId) {
    rec = inMemoryCatalog.get(trackId)
  }
  if (!rec && providerTrackId) {
    rec = inMemoryCatalog.get(providerTrackId) || inMemoryCatalog.get(normalizeTrackId(providerTrackId))
  }

  const effectiveTrackId = trackId || rec?.id
  const effectiveProviderTrackId = providerTrackId || rec?.providerTrackId
  const effectiveStoragePath = inputStoragePath || rec?.storagePath

  // 1. Remove audio file from Supabase Storage
  if (isSupabaseConfigured() && effectiveStoragePath) {
    try {
      await supabase.storage.from(bucketName).remove([effectiveStoragePath])
    } catch {
      // Non-blocking
    }
  }

  // 2. Delete the record from Supabase catalog_tracks table so it completely disappears from catalog
  if (isSupabaseConfigured()) {
    try {
      if (effectiveTrackId) {
        await supabase.from('catalog_tracks').delete().eq('id', effectiveTrackId)
      }
      if (effectiveProviderTrackId) {
        const norm = normalizeTrackId(effectiveProviderTrackId)
        await supabase
          .from('catalog_tracks')
          .delete()
          .in('provider_track_id', [effectiveProviderTrackId, norm, `spotify:track:${norm}`])
      }
    } catch {
      // Non-blocking
    }

    // Also strip audio from any playlist_tracks referencing this provider_track_id
    if (effectiveProviderTrackId) {
      try {
        const norm = normalizeTrackId(effectiveProviderTrackId)
        await supabase
          .from('playlist_tracks')
          .update({
            audio_source_type: 'none',
            storage_path: null,
            audio_url: null,
          })
          .in('provider_track_id', [effectiveProviderTrackId, norm, `spotify:track:${norm}`])
      } catch {
        // Non-blocking
      }
    }
  }

  // 3. Delete from in-memory catalog
  if (effectiveTrackId) {
    inMemoryCatalog.delete(effectiveTrackId)
  }
  if (effectiveProviderTrackId) {
    inMemoryCatalog.delete(effectiveProviderTrackId)
    inMemoryCatalog.delete(normalizeTrackId(effectiveProviderTrackId))
  }

  // 4. Delete from global audio registry & localStorage & server registry
  if (effectiveProviderTrackId) {
    deleteCachedAudioRecord(effectiveProviderTrackId)
  }

  // 5. Dispatch global UI reactivity events
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(
      new CustomEvent('orbim:audio-updated', {
        detail: {
          providerTrackId: effectiveProviderTrackId,
          audioUrl: null,
          storagePath: null,
        },
      }),
    )
    window.dispatchEvent(
      new CustomEvent('orbim:catalog-updated', {
        detail: {
          trackId: effectiveTrackId,
          providerTrackId: effectiveProviderTrackId,
        },
      }),
    )
    window.dispatchEvent(new CustomEvent('orbim:catalog-published', { detail: {} }))
    window.dispatchEvent(new CustomEvent('orbim:playlist-updated', { detail: {} }))
  }

  return { success: true }
}

/**
 * Unpublishes a catalog track, removing it from regular users' visibility and playback.
 * Strictly restricted to Platform Administrators.
 */
export async function unpublishCatalogTrack(params: {
  trackId: string
  userEmail?: string | null
}): Promise<{ success: boolean; error?: Error }> {
  const { trackId, userEmail } = params

  if (!isUserAdmin(userEmail)) {
    return {
      success: false,
      error: new Error('Hanya akun administrator yang diizinkan mencabut publikasi (unpublish) lagu.'),
    }
  }

  const existing = inMemoryCatalog.get(trackId)
  if (existing) {
    existing.publicationStatus = 'unpublished'
    existing.updatedAt = new Date().toISOString()
    deleteCachedAudioRecord(existing.providerTrackId)
  }

  if (isSupabaseConfigured()) {
    try {
      await supabase
        .from('catalog_tracks')
        .update({
          publication_status: 'unpublished',
          updated_at: new Date().toISOString(),
        })
        .eq('id', trackId)
    } catch {
      // Non-blocking
    }
  }

  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('orbim:catalog-updated', { detail: { trackId } }))
  }

  return { success: true }
}

/**
 * Retrieves a single catalog track, strictly respecting publication visibility.
 * Regular users receive null for any draft or unpublished track.
 */
export function getCatalogTrack(trackIdOrProviderId: string, userEmail?: string | null): CatalogTrackRecord | null {
  if (!trackIdOrProviderId) return null
  const norm = normalizeTrackId(trackIdOrProviderId)

  const record = inMemoryCatalog.get(trackIdOrProviderId) || inMemoryCatalog.get(norm) || null
  if (!record) return null

  // If caller is NOT admin, they are strictly forbidden from seeing draft or unpublished tracks,
  // or published tracks that do not have confirmed audio
  if (!isUserAdmin(userEmail)) {
    if (record.publicationStatus !== 'published') {
      return null
    }
    const hasAudio = Boolean(
      (record.storagePath && record.storagePath.trim()) ||
      (record.audioUrl && record.audioUrl.trim()) ||
      getCachedAudioRecord(record.providerTrackId),
    )
    if (!hasAudio) {
      return null
    }
  }

  return record
}
