import { supabase } from '../../lib/supabase.ts'
import type { MusicTrack } from '../../types/music.ts'
import type { MusicProvider, TrackSearchOptions } from './types.ts'

/**
 * Turns a PostgREST/PostgreSQL error into an honest, non-leaking message.
 *
 * Row Level Security rejects anonymous catalogue reads, so guests are told to sign in
 * instead of being shown raw "permission denied for table playlist_tracks" output.
 */
function describeCatalogError(action: string, error: { message: string; code?: string }): string {
  const message = error.message.toLowerCase()
  const isPermissionError =
    error.code === '42501' || message.includes('permission denied') || message.includes('row-level security')

  if (isPermissionError) {
    return 'Sign in to browse tracks saved in the ORBIM database. Row Level Security restricts anonymous access to the playlist catalogue.'
  }

  return `Failed to ${action}: ${error.message}`
}

/**
 * ORBIM saved-tracks provider.
 *
 * Reads `playlist_tracks` rows that Row Level Security exposes to the caller: tracks in
 * playlists they own or collaborate on. It is deliberately NOT a global music catalog —
 * global discovery is served by the Spotify provider. This class stays in use for
 * saved-track lookups such as bulk-import de-duplication, and never falls back to
 * mock/demo data.
 */
export class DatabaseMusicProvider implements MusicProvider {
  readonly id = 'orbim' as const
  readonly name = 'ORBIM Database'

  async searchTracks(query: string, options: TrackSearchOptions = {}): Promise<MusicTrack[]> {
    if (options.signal?.aborted) {
      throw new DOMException('Search aborted', 'AbortError')
    }

    const limit = options.limit ?? 24
    const offset = options.offset ?? 0
    const cleanQuery = query.trim()

    // Query the saved tracks this caller can read — no fallback to mock data
    let req = supabase
      .from('playlist_tracks')
      .select('*')
      .order('added_at', { ascending: false })

    if (cleanQuery) {
      req = req.or(`title.ilike.%${cleanQuery}%,artist_name.ilike.%${cleanQuery}%`)
    }

    req = req.range(offset, offset + limit - 1)

    const { data, error } = await req

    if (error) {
      throw new Error(describeCatalogError('search the ORBIM catalog', error))
    }

    if (!data || data.length === 0) {
      return []
    }

    // Deduplicate tracks by artist + title so unique songs appear in catalog search
    const seen = new Set<string>()
    const tracks: MusicTrack[] = []

    for (const row of data) {
      const key = `${row.artist_name.toLowerCase()}:::${row.title.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)

      tracks.push({
        provider: (row.provider as 'orbim' | 'custom' | 'demo') || 'orbim',
        providerTrackId: row.provider_track_id,
        title: row.title,
        artistName: row.artist_name,
        albumName: row.album_name || undefined,
        artworkUrl: row.artwork_url || undefined,
        durationSeconds: row.duration_seconds || 0,
        genre: 'ORBIM Database',
        moods: [],
        isPlayable: false,
        lyricsStatus: 'not_available',
        lyricsNotice: 'Lirik belum tersedia.',
        attributionText: 'ORBIM Database',
      })
    }

    return tracks
  }

  async getTrack(trackId: string, options?: { signal?: AbortSignal }): Promise<MusicTrack | null> {
    if (options?.signal?.aborted) {
      throw new DOMException('Get track aborted', 'AbortError')
    }

    const { data, error } = await supabase
      .from('playlist_tracks')
      .select('*')
      .eq('provider_track_id', trackId)
      .limit(1)
      .maybeSingle()

    if (error) {
      throw new Error(describeCatalogError('load a track from the ORBIM catalog', error))
    }

    if (!data) {
      return null
    }

    return {
      provider: (data.provider as 'orbim' | 'custom' | 'demo') || 'orbim',
      providerTrackId: data.provider_track_id,
      title: data.title,
      artistName: data.artist_name,
      albumName: data.album_name || undefined,
      artworkUrl: data.artwork_url || undefined,
      durationSeconds: data.duration_seconds || 0,
      genre: 'ORBIM Database',
      moods: [],
      isPlayable: false,
      lyricsStatus: 'not_available',
      attributionText: 'ORBIM Database',
    }
  }
}
