/**
 * Client-Side Spotify Metadata Search Service.
 *
 * Calls the server-side Spotify API endpoint (/api/spotify/search)
 * which authenticates via Client Credentials without exposing client secrets to the browser.
 * Falls back to client-side PKCE token if available.
 *
 * Strict Rules:
 * - Spotify tracks have isPlayable = false and playbackUrl = undefined (never preview_url).
 * - Full audio comes exclusively from user uploads stored in Supabase Storage.
 * - Deep linking (externalUrl) links to open.spotify.com adhering to Spotify terms.
 */

import type { MusicTrack } from '../../types/music.ts'
import { getValidSpotifyAccessToken } from './auth.ts'
import { SPOTIFY_API_BASE_URL, SPOTIFY_MAX_SEARCH_LIMIT } from './config.ts'
import type { SpotifySearchTracksResponse } from './types.ts'

export interface SearchSpotifyMetadataOptions {
  limit?: number
  offset?: number
  signal?: AbortSignal
  fetchFn?: typeof fetch
}

export async function checkSpotifyServerHealth(options?: {
  fetchFn?: typeof fetch
}): Promise<{ ok: boolean; configured: boolean }> {
  const fetchFn = options?.fetchFn || globalThis.fetch
  try {
    const res = await fetchFn('/api/spotify/health')
    if (res.ok) {
      const data = (await res.json()) as { ok?: boolean; configured?: boolean }
      return { ok: Boolean(data.ok), configured: Boolean(data.configured) }
    }
  } catch {
    // ignore
  }
  return { ok: false, configured: false }
}

/**
 * Searches the Spotify catalog for track metadata using server-side authentication.
 */
export async function searchSpotifyMetadata(
  query: string,
  options?: SearchSpotifyMetadataOptions,
): Promise<MusicTrack[]> {
  const cleanQuery = query.trim()
  if (!cleanQuery) {
    return []
  }

  const limit = Math.max(1, Math.min(options?.limit ?? SPOTIFY_MAX_SEARCH_LIMIT, SPOTIFY_MAX_SEARCH_LIMIT))
  const offset = Math.max(0, options?.offset ?? 0)
  const fetchFn = options?.fetchFn || globalThis.fetch

  // 1. First attempt: Server-Side Spotify Endpoint (/api/spotify/search)
  try {
    let serverUrl = `/api/spotify/search?q=${encodeURIComponent(cleanQuery)}&limit=${limit}`
    if (offset > 0) {
      serverUrl += `&offset=${offset}`
    }
    const res = await fetchFn(serverUrl, {
      signal: options?.signal,
      headers: {
        Accept: 'application/json',
      },
    })

    if (res.ok) {
      const data = (await res.json()) as {
        tracks?: Array<{
          id: string
          title: string
          artistName: string
          albumName?: string
          artworkUrl?: string
          durationSeconds: number
          spotifyUrl?: string
          isExplicit?: boolean
        }>
      }

      const items = data.tracks || []
      return items.map((t) => ({
        provider: 'spotify' as const,
        providerTrackId: t.id,
        title: t.title,
        artistName: t.artistName,
        albumName: t.albumName,
        artworkUrl: t.artworkUrl,
        durationSeconds: t.durationSeconds,
        genre: 'Spotify',
        moods: [],
        // Core rule: Never playable from Spotify directly; requires user-uploaded audio
        isPlayable: false,
        playbackUrl: undefined,
        isExplicit: t.isExplicit === true,
        externalUrl: t.spotifyUrl,
        shareUrl: t.spotifyUrl,
        attributionText: 'Spotify',
        lyricsStatus: 'not_available' as const,
      }))
    }
  } catch {
    if (options?.signal?.aborted) {
      throw new DOMException('Search aborted', 'AbortError')
    }
    // Fall back to direct PKCE if available
  }

  // 2. Fallback: Client-side PKCE User Session (if user has authorized their account)
  const userToken = await getValidSpotifyAccessToken().catch(() => null)
  if (userToken) {
    const spotifyUrl = new URL(`${SPOTIFY_API_BASE_URL}/search`)
    spotifyUrl.searchParams.set('q', cleanQuery)
    spotifyUrl.searchParams.set('type', 'track')
    spotifyUrl.searchParams.set('limit', String(limit))

    const res = await fetchFn(spotifyUrl.toString(), {
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
      signal: options?.signal,
    })

    if (res.ok) {
      const data = (await res.json()) as SpotifySearchTracksResponse
      const items = data.tracks?.items || []
      return items.map((item) => ({
        provider: 'spotify' as const,
        providerTrackId: item.id,
        title: item.name,
        artistName: item.artists?.map((a) => a.name).join(', ') || 'Unknown Artist',
        albumName: item.album?.name,
        artworkUrl: item.album?.images?.[0]?.url,
        durationSeconds: Math.max(0, Math.round((item.duration_ms || 0) / 1000)),
        genre: 'Spotify',
        moods: [],
        // Core rule: Never playable from Spotify directly; requires user-uploaded audio
        isPlayable: false,
        playbackUrl: undefined,
        isExplicit: item.explicit === true,
        externalUrl: item.external_urls?.spotify,
        shareUrl: item.external_urls?.spotify,
        attributionText: 'Spotify',
        lyricsStatus: 'not_available' as const,
      }))
    }
  }

  throw new Error('Unable to search Spotify. Please check network connection or server credentials.')
}
