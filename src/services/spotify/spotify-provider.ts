/**
 * Spotify Music Provider for ORBIM.
 *
 * Adheres strictly to Spotify Developer Platform rules:
 * - Development Mode limit: search clamped to a maximum of 10 items.
 * - Rate limiting (HTTP 429): parses Retry-After header and propagates friendly warnings.
 * - Development Mode access (HTTP 403): alerts about the 5-user allowlist restriction.
 * - Honest playback labeling: marks tracks as unplayable without inventing fake audio streams
 *   (or uses preview_url only if actually confirmed present by the API).
 * - Deep linking: attaches externalUrl to open tracks directly on Spotify.
 */

import { MusicProviderError, type MusicProvider, type TrackSearchOptions } from '../music/types.ts'
import type { MusicTrack } from '../../types/music.ts'
import { disconnectSpotify, getValidSpotifyAccessToken } from './auth.ts'
import { SPOTIFY_API_BASE_URL, SPOTIFY_MAX_SEARCH_LIMIT } from './config.ts'
import { searchSpotifyMetadata } from './metadata-search.ts'
import type { SpotifySearchTracksResponse, SpotifyTrackItem } from './types.ts'

export class SpotifyMusicProvider implements MusicProvider {
  readonly id = 'spotify' as const
  readonly name = 'Spotify'

  private fetchFn: typeof fetch

  constructor(options?: { fetchFn?: typeof fetch }) {
    // Native browser fetch must be bound to the global object: WebIDL rejects
    // method-style invocation (`this.fetchFn(...)`), throwing
    // "Illegal invocation" before any network request is made. Binding at
    // construction keeps the call sites this-agnostic for both real fetch and
    // injected test doubles. Keep in sync with auth.ts, which already calls the
    // extracted reference bare (`customFetch(...)`).
    this.fetchFn = options?.fetchFn || globalThis.fetch.bind(globalThis)
  }

  /**
   * Maps a Spotify API track item to ORBIM's provider-neutral MusicTrack shape.
   */
  mapTrack(item: SpotifyTrackItem): MusicTrack {
    const hasPlayablePreview = typeof item.preview_url === 'string' && item.preview_url.length > 0

    return {
      provider: 'spotify',
      providerTrackId: item.id,
      title: item.name,
      artistName: item.artists?.map((artist) => artist.name).join(', ') || 'Unknown Artist',
      albumName: item.album?.name || undefined,
      artworkUrl: item.album?.images?.[0]?.url || undefined,
      durationSeconds: Math.max(0, Math.round((item.duration_ms || 0) / 1000)),
      genre: 'Spotify',
      moods: [],
      // Honest playback: unplayable unless a confirmed preview/stream URL is provided by the platform
      isPlayable: hasPlayablePreview,
      playbackUrl: hasPlayablePreview ? item.preview_url! : undefined,
      isExplicit: item.explicit === true,
      externalUrl: item.external_urls?.spotify,
      shareUrl: item.external_urls?.spotify,
      attributionText: 'Spotify',
      lyricsStatus: 'not_available',
    }
  }

  /**
   * Searches the Spotify catalog with query and options.
   * Enforces Spotify Dev Mode limits (max 10 results).
   */
  async searchTracks(query: string, options: TrackSearchOptions = {}): Promise<MusicTrack[]> {
    if (options.signal?.aborted) {
      throw new DOMException('Search aborted', 'AbortError')
    }

    const cleanQuery = query.trim()
    if (!cleanQuery) {
      return []
    }

    // Dev mode enforces max limit of 10 items
    const rawLimit = options.limit ?? SPOTIFY_MAX_SEARCH_LIMIT
    const limit = Math.max(1, Math.min(rawLimit, SPOTIFY_MAX_SEARCH_LIMIT))
    const offset = Math.max(0, options.offset ?? 0)

    let searchQuery = cleanQuery
    if (options.genre && !cleanQuery.toLowerCase().includes('genre:')) {
      searchQuery = `${cleanQuery} genre:"${options.genre}"`
    }

    const accessToken = await getValidSpotifyAccessToken()
    if (!accessToken) {
      // In the browser without a PKCE session, directly query the server Client Credentials API!
      // This enables metadata search without requiring users to connect a Spotify account.
      if (typeof window !== 'undefined') {
        try {
          return await searchSpotifyMetadata(searchQuery, {
            limit,
            offset,
            signal: options.signal,
            fetchFn: this.fetchFn,
          })
        } catch (serverErr: unknown) {
          if (options.signal?.aborted) {
            throw new DOMException('Search aborted', 'AbortError')
          }
          throw new MusicProviderError(
            serverErr instanceof Error ? serverErr.message : 'Unable to reach the Spotify catalog.',
            {
              provider: 'spotify',
              code: 'FETCH_ERROR',
              status: 500,
            },
          )
        }
      }

      throw new MusicProviderError(
        'Spotify account is not connected. Connect your Spotify account to search.',
        {
          provider: 'spotify',
          code: 'UNAUTHORIZED',
          status: 401,
        },
      )
    }

    const url = new URL(`${SPOTIFY_API_BASE_URL}/search`)
    url.searchParams.set('q', searchQuery)
    url.searchParams.set('type', 'track')
    url.searchParams.set('limit', String(limit))
    url.searchParams.set('offset', String(offset))

    let response: Response
    try {
      response = await this.fetchFn(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: options.signal,
      })
    } catch (err) {
      if (options.signal?.aborted) {
        throw new DOMException('Search aborted', 'AbortError')
      }
      // Preserve the raw rejection cause for debugging without hiding it behind
      // the generic message. Only the error name/type is printed — never tokens,
      // authorization headers, or query secrets.
      console.error(
        '[Spotify] search request rejected:',
        err instanceof Error ? `${err.name}: ${err.message}` : typeof err,
      )
      throw new MusicProviderError(
        'Network error while connecting to Spotify Web API.',
        {
          provider: 'spotify',
          isNetworkError: true,
          cause: err,
        },
      )
    }

    // Handle 429 Rate Limit
    if (response.status === 429) {
      const retryAfter = response.headers?.get('Retry-After') || 'a few'
      throw new MusicProviderError(
        `Spotify rate limit exceeded. Please wait ${retryAfter} seconds before trying again.`,
        {
          provider: 'spotify',
          status: 429,
          code: 'RATE_LIMITED',
        },
      )
    }

    // Handle 403 Forbidden (e.g. not on 5-user Dev Mode allowlist)
    if (response.status === 403) {
      throw new MusicProviderError(
        'Spotify API access restricted. In Development Mode, only up to 5 allowlisted users are authorized.',
        {
          provider: 'spotify',
          status: 403,
          code: 'DEV_MODE_RESTRICTED',
        },
      )
    }

    // Handle 401 Unauthorized — the stored session is no longer usable, so clear it and
    // let Explore return to the "Connect Spotify" prompt instead of retrying forever.
    if (response.status === 401) {
      disconnectSpotify()
      throw new MusicProviderError(
        'Spotify authorization expired. Please reconnect your Spotify account.',
        {
          provider: 'spotify',
          status: 401,
          code: 'UNAUTHORIZED',
        },
      )
    }

    if (response.status === 400) {
      throw new MusicProviderError(
        'Spotify rejected the search request (HTTP 400). The query may be malformed or exceed the allowed result limit.',
        {
          provider: 'spotify',
          status: 400,
          code: 'INVALID_REQUEST',
        },
      )
    }

    if (!response.ok) {
      throw new MusicProviderError(
        `Spotify search failed with status ${response.status}`,
        {
          provider: 'spotify',
          status: response.status,
          code: 'API_ERROR',
        },
      )
    }

    const data = (await response.json()) as SpotifySearchTracksResponse
    const items = data.tracks?.items || []

    // Local/unavailable Spotify items have no id and cannot be saved to a playlist.
    return items.filter((item) => Boolean(item?.id)).map((item) => this.mapTrack(item))
  }

  /**
   * Retrieves single track metadata by Spotify ID.
   */
  async getTrack(trackId: string, options?: { signal?: AbortSignal }): Promise<MusicTrack | null> {
    if (options?.signal?.aborted) {
      throw new DOMException('Get track aborted', 'AbortError')
    }

    const cleanId = trackId.trim()
    if (!cleanId) return null

    const accessToken = await getValidSpotifyAccessToken()
    if (!accessToken) {
      throw new MusicProviderError(
        'Spotify account is not connected.',
        {
          provider: 'spotify',
          code: 'UNAUTHORIZED',
          status: 401,
        },
      )
    }

    let response: Response
    try {
      response = await this.fetchFn(`${SPOTIFY_API_BASE_URL}/tracks/${encodeURIComponent(cleanId)}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: options?.signal,
      })
    } catch (err) {
      if (options?.signal?.aborted) {
        throw new DOMException('Get track aborted', 'AbortError')
      }
      throw new MusicProviderError(
        'Network error while connecting to Spotify Web API.',
        {
          provider: 'spotify',
          isNetworkError: true,
          cause: err,
        },
      )
    }

    if (response.status === 404) {
      return null
    }

    if (response.status === 429) {
      const retryAfter = response.headers?.get('Retry-After') || 'a few'
      throw new MusicProviderError(
        `Spotify rate limit exceeded. Please wait ${retryAfter} seconds.`,
        {
          provider: 'spotify',
          status: 429,
          code: 'RATE_LIMITED',
        },
      )
    }

    if (response.status === 401) {
      disconnectSpotify()
      throw new MusicProviderError(
        'Spotify authorization expired. Please reconnect your Spotify account.',
        {
          provider: 'spotify',
          status: 401,
          code: 'UNAUTHORIZED',
        },
      )
    }

    if (!response.ok) {
      throw new MusicProviderError(
        `Failed to fetch Spotify track (status ${response.status})`,
        {
          provider: 'spotify',
          status: response.status,
          code: 'API_ERROR',
        },
      )
    }

    const item = (await response.json()) as SpotifyTrackItem
    if (!item?.id) return null
    return this.mapTrack(item)
  }
}
