/**
 * VYBE Music Provider for ORBIM (Phase 2 Skeleton & Fixtures).
 *
 * Implements the normalized MusicProvider interface for VYBE Library.
 * Adheres strictly to:
 * - Attribution requirements: "Music from VYBE", artist name, track title, artist link.
 * - Credential boundaries: rejects secret keys on client side.
 * - Coexistence: keeps provider-specific identifiers ('vybe') isolated from Spotify.
 */

import { MusicProviderError, type MusicProvider, type TrackSearchOptions } from '../music/types.ts'
import type { MusicTrack } from '../../types/music.ts'
import {
  assertNotVybeSecretKey,
  VYBE_API_BASE_URL,
  VYBE_ATTRIBUTION_TEXT,
  VYBE_LEGAL_URL,
} from './config.ts'
import { MOCK_VYBE_CATALOG } from './mock-fixtures.ts'
import type { VybeApiTrackItem, VybeSearchTracksResponse } from './types.ts'

export interface VybeMusicProviderOptions {
  /** Injectable fetch for unit tests */
  fetchFn?: typeof fetch
  /** Public key (vybe_pub_...) or session token (vybe_ct_...) */
  apiKey?: string
  /** If true, serves offline mock fixtures (Phase 2 development/test mode) */
  useMockCatalog?: boolean
}

export class VybeMusicProvider implements MusicProvider {
  readonly id = 'vybe' as const
  readonly name = 'VYBE'

  private fetchFn: typeof fetch
  private apiKey?: string
  private useMockCatalog: boolean

  constructor(options: VybeMusicProviderOptions = {}) {
    // Enforce that secret keys never enter frontend client code
    assertNotVybeSecretKey(options.apiKey)

    this.fetchFn = options.fetchFn || globalThis.fetch.bind(globalThis)
    this.apiKey = options.apiKey
    // Defaults to mock catalog in Phase 2 unless an explicit live key + fetch is supplied
    this.useMockCatalog = options.useMockCatalog ?? true
  }

  /**
   * Maps a raw VYBE API track item to ORBIM's provider-neutral MusicTrack interface.
   * Handles documented variations:
   * - artist as string or artist object
   * - artwork as artwork URL or artwork_url
   * - duration in seconds (float or int)
   * - attribution text strictly "Music from VYBE"
   */
  mapTrack(item: VybeApiTrackItem): MusicTrack {
    const artistName =
      typeof item.artist === 'string'
        ? item.artist
        : item.artist?.name || 'Unknown Artist'

    const artistUrl =
      typeof item.artist === 'object' && item.artist?.url
        ? item.artist.url
        : typeof item.artist === 'object' && item.artist?.slug
          ? `https://vybemusic.com/artists/${item.artist.slug}`
          : undefined

    const albumName =
      typeof item.album === 'string'
        ? item.album
        : item.album?.title || undefined

    const artworkUrl = item.artwork || item.artwork_url || undefined

    const externalUrl =
      item.url ||
      (item.slug
        ? `https://vybemusic.com/tracks/${item.slug}`
        : `https://vybemusic.com/tracks/${item.id}`)

    const durationSeconds =
      typeof item.duration === 'number'
        ? Math.max(0, Math.round(item.duration))
        : typeof item.duration_ms === 'number'
          ? Math.max(0, Math.round(item.duration_ms / 1000))
          : 0

    const moods = Array.isArray(item.vybes)
      ? item.vybes
      : item.vybe
        ? [item.vybe]
        : item.vibe
          ? [item.vibe]
          : []

    let lyricsSnippet: string | undefined
    let lyricsText: string | undefined
    if (Array.isArray(item.lyrics) && item.lyrics.length > 0) {
      lyricsSnippet = item.lyrics[0]?.text
      lyricsText = item.lyrics.map((l) => l.text).join('\n')
    } else if (typeof item.lyrics === 'string') {
      lyricsText = item.lyrics
      lyricsSnippet = item.lyrics.split('\n')[0]
    }

    return {
      provider: 'vybe',
      providerTrackId: item.id,
      title: item.title,
      artistName,
      artistUrl,
      albumName,
      artworkUrl,
      durationSeconds,
      genre: item.genre || item.vybe || item.vibe || 'VYBE Independent',
      moods,
      isPlayable: true,
      playbackUrl: item.stream_url || undefined,
      externalUrl,
      shareUrl: externalUrl,
      attributionText: VYBE_ATTRIBUTION_TEXT,
      licenseUrl: VYBE_LEGAL_URL,
      lyricsStatus: lyricsText ? 'available' : 'not_available',
      lyrics: lyricsText,
      lyricsSnippet,
      lyricsNotice: VYBE_ATTRIBUTION_TEXT,
    }
  }

  /**
   * Searches the VYBE catalog with query and options.
   * In Phase 2, runs offline against mock fixtures unless a live fetch double is injected.
   */
  async searchTracks(query: string, options: TrackSearchOptions = {}): Promise<MusicTrack[]> {
    if (options.signal?.aborted) {
      throw new DOMException('Search aborted', 'AbortError')
    }

    const cleanQuery = query.trim().toLowerCase()

    // Offline / Fixture mode for Phase 2
    if (this.useMockCatalog) {
      let filtered = MOCK_VYBE_CATALOG

      if (cleanQuery) {
        filtered = filtered.filter((track) => {
          const artist = typeof track.artist === 'string' ? track.artist : track.artist.name
          return (
            track.title.toLowerCase().includes(cleanQuery) ||
            artist.toLowerCase().includes(cleanQuery) ||
            (track.album &&
              (typeof track.album === 'string'
                ? track.album
                : track.album.title
              ).toLowerCase().includes(cleanQuery)) ||
            (track.vybes && track.vybes.some((v) => v.toLowerCase().includes(cleanQuery)))
          )
        })
      }

      if (options.genre) {
        const genreFilter = options.genre.toLowerCase()
        filtered = filtered.filter(
          (t) =>
            t.genre?.toLowerCase() === genreFilter ||
            t.vybe?.toLowerCase() === genreFilter ||
            t.vibe?.toLowerCase() === genreFilter ||
            (t.vybes && t.vybes.some((v) => v.toLowerCase() === genreFilter)),
        )
      }

      const limit = options.limit ?? 20
      const offset = options.offset ?? 0
      return filtered.slice(offset, offset + limit).map((item) => this.mapTrack(item))
    }

    // Live search path (when live key and API are approved)
    const url = new URL(`${VYBE_API_BASE_URL}/tracks`)
    if (cleanQuery) {
      url.searchParams.set('q', cleanQuery)
    }
    if (options.genre) {
      url.searchParams.set('vybe', options.genre)
    }
    if (options.limit) {
      url.searchParams.set('limit', String(options.limit))
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
    }
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }

    let response: Response
    try {
      response = await this.fetchFn(url.toString(), {
        headers,
        signal: options.signal,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err
      }
      throw new MusicProviderError('Network error connecting to VYBE Library.', {
        provider: 'vybe',
        isNetworkError: true,
        cause: err,
      })
    }

    if (!response.ok) {
      throw new MusicProviderError(
        `VYBE Library request failed with status HTTP ${response.status}.`,
        {
          provider: 'vybe',
          status: response.status,
        },
      )
    }

    const data = (await response.json()) as VybeSearchTracksResponse | VybeApiTrackItem[]
    const items = Array.isArray(data) ? data : data.tracks || []
    return items.map((item) => this.mapTrack(item))
  }

  /**
   * Retrieves a single track by its ID.
   */
  async getTrack(trackId: string, options?: { signal?: AbortSignal }): Promise<MusicTrack | null> {
    if (options?.signal?.aborted) {
      throw new DOMException('Get track aborted', 'AbortError')
    }

    if (this.useMockCatalog) {
      const match = MOCK_VYBE_CATALOG.find((t) => t.id === trackId)
      return match ? this.mapTrack(match) : null
    }

    const url = `${VYBE_API_BASE_URL}/tracks/${encodeURIComponent(trackId)}`
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }

    let response: Response
    try {
      response = await this.fetchFn(url, { headers, signal: options?.signal })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err
      }
      throw new MusicProviderError('Network error retrieving track from VYBE.', {
        provider: 'vybe',
        isNetworkError: true,
        cause: err,
      })
    }

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      throw new MusicProviderError(`Failed to fetch VYBE track (HTTP ${response.status}).`, {
        provider: 'vybe',
        status: response.status,
      })
    }

    const item = (await response.json()) as VybeApiTrackItem
    return this.mapTrack(item)
  }
}
