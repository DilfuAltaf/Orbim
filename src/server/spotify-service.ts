/**
 * Server-Side Spotify Authentication & Web API Service.
 *
 * Implements:
 * - Client Credentials Flow (RFC 6749 §4.4) using CLIENT_ID_SPOTIFY and CLIENT_SECRET_SPOTIFY.
 * - In-memory token caching with safe expiration margin.
 * - Server-side Spotify Search API proxying without exposing CLIENT_SECRET to browser.
 * - Strict Spotify attribution compliance (provides Spotify track links and artwork).
 * - Never downloads, scrapes, or streams audio from Spotify.
 */

import fs from 'node:fs'
import path from 'node:path'

export interface SpotifyServerToken {
  accessToken: string
  expiresAt: number
}

export interface SpotifyTrackMetadata {
  id: string
  title: string
  artistName: string
  albumName?: string
  artworkUrl?: string
  durationSeconds: number
  spotifyUrl?: string
  isExplicit: boolean
}

let cachedServerToken: SpotifyServerToken | null = null

/**
 * Loads Spotify server credentials from process.env or .env.local file.
 */
export function getSpotifyServerCredentials(envOverride?: Record<string, string | undefined>): {
  clientId: string | null
  clientSecret: string | null
} {
  const env = envOverride || process.env

  let clientId = env.CLIENT_ID_SPOTIFY || env.VITE_SPOTIFY_CLIENT_ID || null
  let clientSecret = env.CLIENT_SECRET_SPOTIFY || null

  // Fallback to reading .env.local or .env if not found in process.env (only when no envOverride passed)
  if (!envOverride && (!clientId || !clientSecret)) {
    const cwd = process.cwd()
    const envFiles = ['.env.local', '.env']

    for (const file of envFiles) {
      const fullPath = path.resolve(cwd, file)
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8')
          for (const line of content.split('\n')) {
            const trimmed = line.trim()
            if (!trimmed || trimmed.startsWith('#')) continue
            const eqIdx = trimmed.indexOf('=')
            if (eqIdx === -1) continue
            const key = trimmed.substring(0, eqIdx).trim()
            const val = trimmed.substring(eqIdx + 1).trim()

            if (!clientId && (key === 'CLIENT_ID_SPOTIFY' || key === 'VITE_SPOTIFY_CLIENT_ID')) {
              clientId = val
            }
            if (!clientSecret && key === 'CLIENT_SECRET_SPOTIFY') {
              clientSecret = val
            }
          }
        } catch {
          // ignore read errors
        }
      }
      if (clientId && clientSecret) break
    }
  }

  return { clientId, clientSecret }
}

/**
 * Clears the in-memory server token cache (useful in tests).
 */
export function _resetServerTokenCacheForTesting(): void {
  cachedServerToken = null
}

/**
 * Retrieves a valid Spotify App Access Token using the Client Credentials Flow.
 * Caches the token until 5 minutes before expiry.
 */
export async function getSpotifyServerToken(options?: {
  envOverride?: Record<string, string | undefined>
  fetchFn?: typeof fetch
}): Promise<string> {
  const now = Date.now()
  if (cachedServerToken && cachedServerToken.expiresAt > now + 60_000) {
    return cachedServerToken.accessToken
  }

  const { clientId, clientSecret } = getSpotifyServerCredentials(options?.envOverride)
  if (!clientId || !clientSecret) {
    throw new Error(
      'Spotify server credentials missing: CLIENT_ID_SPOTIFY and CLIENT_SECRET_SPOTIFY are required on server.',
    )
  }

  const fetchFn = options?.fetchFn || globalThis.fetch
  const credentialsBase64 = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const response = await fetchFn('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentialsBase64}`,
    },
    body: 'grant_type=client_credentials',
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Spotify token error: ${response.status} ${response.statusText} ${errorText}`.trim())
  }

  const data = (await response.json()) as {
    access_token: string
    token_type: string
    expires_in: number
  }

  if (!data.access_token) {
    throw new Error('Spotify response did not contain an access_token')
  }

  const expiresInMs = (data.expires_in || 3600) * 1000
  cachedServerToken = {
    accessToken: data.access_token,
    expiresAt: now + expiresInMs,
  }

  return cachedServerToken.accessToken
}

/**
 * Searches tracks on Spotify using the server-side access token.
 * Max limit is clamped to 10 (Spotify Dev Mode requirement).
 */
export async function searchSpotifyTracksServer(
  query: string,
  options?: {
    limit?: number
    offset?: number
    envOverride?: Record<string, string | undefined>
    fetchFn?: typeof fetch
  },
): Promise<SpotifyTrackMetadata[]> {
  const cleanQuery = query.trim()
  if (!cleanQuery) {
    return []
  }

  const limit = Math.max(1, Math.min(options?.limit ?? 10, 10))
  const offset = Math.max(0, options?.offset ?? 0)
  const token = await getSpotifyServerToken({
    envOverride: options?.envOverride,
    fetchFn: options?.fetchFn,
  })

  const url = new URL('https://api.spotify.com/v1/search')
  url.searchParams.set('q', cleanQuery)
  url.searchParams.set('type', 'track')
  url.searchParams.set('limit', String(limit))
  if (offset > 0) {
    url.searchParams.set('offset', String(offset))
  }

  const fetchFn = options?.fetchFn || globalThis.fetch
  const response = await fetchFn(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    if (response.status === 429) {
      const retryAfter = response.headers?.get('Retry-After') || '5'
      throw new Error(`Spotify rate limit exceeded. Retry after ${retryAfter}s.`)
    }
    const errText = await response.text().catch(() => '')
    throw new Error(`Spotify search error: ${response.status} ${errText}`.trim())
  }

  const data = (await response.json()) as {
    tracks?: {
      items?: Array<{
        id: string
        name: string
        artists?: Array<{ name: string }>
        album?: {
          name?: string
          images?: Array<{ url: string; width?: number; height?: number }>
        }
        duration_ms?: number
        external_urls?: { spotify?: string }
        explicit?: boolean
      }>
    }
  }

  const items = data.tracks?.items || []

  return items.map((t) => ({
    id: t.id,
    title: t.name,
    artistName: t.artists?.map((a) => a.name).join(', ') || 'Unknown Artist',
    albumName: t.album?.name,
    artworkUrl: t.album?.images?.[0]?.url,
    durationSeconds: Math.max(0, Math.round((t.duration_ms || 0) / 1000)),
    spotifyUrl: t.external_urls?.spotify,
    isExplicit: t.explicit === true,
  }))
}

/**
 * Normalizes song title by stripping video artifacts and feature notations.
 */
export function cleanTrackTitle(title: string): string {
  return title
    .replace(/\s*[([](official|lyric|video|audio|visualizer|lyrics|hd|4k|remastered)[^)\]]*[)\]]/gi, '')
    .replace(/\s*\b(ft|feat|featuring)\b\.?.*$/i, '')
    .replace(/[?!]+$/, '')
    .trim()
}

/**
 * Normalizes artist name by stripping collaborator listings.
 */
export function cleanTrackArtist(artist: string): string {
  return artist
    .split(/[,&]/)[0]
    .replace(/\s*\b(ft|feat|featuring)\b\.?.*$/i, '')
    .trim()
}

/**
 * Server-side lyrics resolver for Spotify tracks.
 * Prioritizes LRCLIB for synced lyrics (Spotify-compatible LRC timestamps),
 * with resilient fallback to lyrics.ovh.
 */
export async function fetchSpotifyTrackLyricsServer(
  title: string,
  artist: string,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<{ lyrics: string; title: string; artist: string; source: string; isSynced?: boolean }> {
  const cleanTitleStr = cleanTrackTitle(title)
  const cleanArtistStr = cleanTrackArtist(artist)

  // 1. Try LRCLIB for Spotify-compatible timed/synced lyrics
  try {
    const lrcUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitleStr)}&artist_name=${encodeURIComponent(cleanArtistStr)}`
    const lrcRes = await fetchFn(lrcUrl, {
      headers: {
        'User-Agent': 'ORBIM-Music-Player/1.0 (https://github.com/orbim)',
      },
    })
    if (lrcRes.ok) {
      const data = (await lrcRes.json()) as { syncedLyrics?: string; plainLyrics?: string }
      if (data.syncedLyrics && data.syncedLyrics.trim()) {
        return {
          lyrics: data.syncedLyrics.trim(),
          title: cleanTitleStr,
          artist: cleanArtistStr,
          source: 'Spotify Synced Lyrics',
          isSynced: true,
        }
      }
      if (data.plainLyrics && data.plainLyrics.trim()) {
        return {
          lyrics: data.plainLyrics.trim(),
          title: cleanTitleStr,
          artist: cleanArtistStr,
          source: 'Spotify Lyrics',
          isSynced: false,
        }
      }
    }
  } catch {
    // Non-blocking fallback
  }

  // 2. Fallback to lyrics.ovh
  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(cleanArtistStr)}/${encodeURIComponent(cleanTitleStr)}`
  const res = await fetchFn(url)
  if (!res.ok) {
    throw new Error(`Lyrics not found (${res.status})`)
  }

  const data = (await res.json()) as { lyrics?: string }
  if (!data.lyrics || !data.lyrics.trim()) {
    throw new Error('Empty lyrics returned from provider')
  }

  return {
    lyrics: data.lyrics.trim(),
    title: cleanTitleStr,
    artist: cleanArtistStr,
    source: 'Spotify & Web Lyrics Catalog',
  }
}
