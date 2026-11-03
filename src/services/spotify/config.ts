/**
 * Spotify Web API Configuration & Constants.
 *
 * Implements strict security rules:
 * - Only the public Client ID is exposed to the browser.
 * - Client Secret is never accessed, imported, or logged in client code.
 * - Supports Development Mode limits (max 10 search results, 5 authorized users).
 */

export const SPOTIFY_AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize'
export const SPOTIFY_TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token'
export const SPOTIFY_API_BASE_URL = 'https://api.spotify.com/v1'

/**
 * Development Mode restriction: Search API max limit is 10 items.
 * Requesting > 10 in Dev Mode causes 400 Bad Request from Spotify API.
 */
export const SPOTIFY_MAX_SEARCH_LIMIT = 10

/**
 * Spotify PKCE refresh tokens expire after six months (180 days) of rolling inactivity
 * or policy expiration. Reauthorization is required once exceeded.
 */
export const SPOTIFY_REFRESH_TOKEN_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000

/**
 * Scopes required for catalog discovery plus in-app Spotify playback.
 *
 * - `streaming`: required by the official Web Playback SDK to create a device.
 * - `user-modify-playback-state`: the SDK exposes only local controls
 *   (pause/resume/seek/volume). Loading a specific track onto our SDK device
 *   requires the Web API `POST /v1/me/player/play` endpoint with `uris`, and
 *   that endpoint needs this scope. It is requested once, up front, so users
 *   consent exactly one time.
 */
export const SPOTIFY_DEFAULT_SCOPES = [
  'user-read-private',
  'user-read-email',
  'streaming',
  'user-modify-playback-state',
] as const

/**
 * Scopes a session must carry before in-app Spotify playback may start.
 * Sessions authorized before P2 hold only the profile scopes and must go
 * through the PKCE flow again to grant the playback scopes.
 */
export const SPOTIFY_PLAYBACK_REQUIRED_SCOPES = [
  'streaming',
  'user-modify-playback-state',
] as const

/**
 * True when a space-separated Spotify scope string contains every scope the
 * Web Playback SDK needs. Token payloads return their granted scope set here.
 */
export function spotifyScopesIncludePlaybackScopes(scope: string | null | undefined): boolean {
  if (typeof scope !== 'string' || scope.trim().length === 0) return false

  const granted = new Set(scope.split(/[ ]+/))
  return SPOTIFY_PLAYBACK_REQUIRED_SCOPES.every((required) => granted.has(required))
}

/**
 * Spotify only ever grants the scopes requested at consent time; the token
 * response's `scope` field is the authoritative granted set. Since February
 * 2026, Development Mode additionally requires a Premium account, and the
 * `streaming` scope is documented as Premium-only, so a granted set can be
 * missing playback scopes without any re-consent fixing it.
 *
 * Returns the required playback scopes absent from the granted set (scopes
 * only — never tokens), so the UI can tell "re-consent needed" apart from
 * "Spotify did not grant playback at all (account eligibility)".
 */
export function spotifyMissingPlaybackScopes(scope: string | null | undefined): string[] {
  if (typeof scope !== 'string' || scope.trim().length === 0) {
    return [...SPOTIFY_PLAYBACK_REQUIRED_SCOPES]
  }

  const granted = new Set(scope.split(/[ ]+/))
  return SPOTIFY_PLAYBACK_REQUIRED_SCOPES.filter((required) => !granted.has(required))
}

interface ProcessEnvHolder {
  process?: {
    env?: Record<string, string | undefined>
  }
}

function getNodeProcessEnv(): Record<string, string | undefined> | undefined {
  if (typeof globalThis !== 'undefined') {
    return (globalThis as ProcessEnvHolder).process?.env
  }
  return undefined
}

/**
 * Retrieves the Spotify Client ID safely without exposing any secret.
 */
export function getSpotifyClientId(envOverride?: Record<string, string | undefined>): string | null {
  const nodeEnv = getNodeProcessEnv()
  const envMap =
    envOverride !== undefined
      ? envOverride
      : typeof import.meta !== 'undefined' && import.meta.env
        ? (import.meta.env as Record<string, string | undefined>)
        : nodeEnv !== undefined
          ? nodeEnv
          : {}

  const id =
    envMap.VITE_SPOTIFY_CLIENT_ID?.trim() ||
    envMap.VITE_CLIENT_ID_SPOTIFY?.trim() ||
    // Exposed to the browser by `envPrefix` in vite.config.ts (public client ID only).
    envMap.CLIENT_ID_SPOTIFY?.trim() ||
    (nodeEnv && nodeEnv.CLIENT_ID_SPOTIFY ? nodeEnv.CLIENT_ID_SPOTIFY.trim() : null)

  return id || null
}

/**
 * Returns whether a valid Spotify Client ID is configured.
 */
export function isSpotifyConfigured(envOverride?: Record<string, string | undefined>): boolean {
  const id = getSpotifyClientId(envOverride)
  return typeof id === 'string' && id.length > 0
}

/**
 * Canonical local development redirect URI.
 *
 * Spotify requires loopback IP literals (`127.0.0.1`) for local HTTP redirects;
 * `localhost` is no longer accepted for local HTTP development. This constant
 * must match a redirect URI registered in the Spotify Developer Dashboard
 * exactly, byte for byte, in both the authorization request and token exchange.
 */
export const SPOTIFY_LOCAL_DEV_REDIRECT_URI = 'http://127.0.0.1:5173/callback/spotify'

const SPOTIFY_LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1'])

/**
 * Resolves the callback redirect URI registered in Spotify Developer Dashboard.
 * Defaults to `${origin}/callback/spotify`.
 *
 * For local development, always returns the canonical loopback IP literal URI
 * regardless of whether the app is browsed via `localhost:5173` or
 * `127.0.0.1:5173`, so the authorization request and token exchange never drift.
 */
export function getSpotifyRedirectUri(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    try {
      const originUrl = new URL(window.location.origin)
      const isLocal =
        SPOTIFY_LOCAL_HOSTNAMES.has(originUrl.hostname) &&
        (originUrl.port === '' || originUrl.port === '5173')
      if (isLocal) {
        return SPOTIFY_LOCAL_DEV_REDIRECT_URI
      }
    } catch {
      // Fall through to origin-based URI if the origin cannot be parsed.
    }
    return `${window.location.origin}/callback/spotify`
  }
  return SPOTIFY_LOCAL_DEV_REDIRECT_URI
}
