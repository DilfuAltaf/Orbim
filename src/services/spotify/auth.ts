/**
 * Spotify PKCE Authentication and Session Management Service.
 *
 * Implements:
 * - Authorization Code Flow with PKCE (Proof Key for Code Exchange).
 * - CSRF state verification.
 * - Token exchange without exposing client secrets.
 * - Automatic token refresh with 6-month refresh-token expiration handling.
 * - Safe browser and test environment storage abstractions.
 */

import {
  getSpotifyClientId,
  getSpotifyRedirectUri,
  SPOTIFY_API_BASE_URL,
  SPOTIFY_AUTH_ENDPOINT,
  SPOTIFY_DEFAULT_SCOPES,
  spotifyScopesIncludePlaybackScopes,
  SPOTIFY_REFRESH_TOKEN_MAX_AGE_MS,
  SPOTIFY_TOKEN_ENDPOINT,
} from './config.ts'
import { generateCodeChallenge, generateCodeVerifier, generateOAuthState } from './pkce.ts'
import type {
  SpotifyAuthErrorPayload,
  SpotifySession,
  SpotifyTokenResponse,
} from './types.ts'

export const SPOTIFY_SESSION_STORAGE_KEY = 'orbim_spotify_session'
export const SPOTIFY_PKCE_STATE_KEY = 'orbim_spotify_pkce_state'
export const SPOTIFY_SESSION_CHANGE_EVENT = 'orbim:spotify-session-updated'

function notifySpotifySessionChanged(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(SPOTIFY_SESSION_CHANGE_EVENT))
  }
}

export class SpotifyAuthError extends Error {
  readonly code?: string
  readonly status?: number

  constructor(message: string, options?: { code?: string; status?: number; cause?: unknown }) {
    super(message)
    this.name = 'SpotifyAuthError'
    this.code = options?.code
    this.status = options?.status
    if (options?.cause !== undefined) {
      this.cause = options.cause
    }
  }
}

interface StoredPKCEState {
  codeVerifier: string
  state: string
  redirectUri: string
  createdAt: number
  scopes?: string[]
}

// In-memory fallback for environments without Web Storage (e.g. Node tests)
let memoryLocalStorage: Record<string, string> = {}
let memorySessionStorage: Record<string, string> = {}

function getLocalStore(): {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
} {
  const holder = globalThis as { localStorage?: Storage }
  if (holder.localStorage) {
    return holder.localStorage
  }
  return {
    getItem: (k) => memoryLocalStorage[k] ?? null,
    setItem: (k, v) => {
      memoryLocalStorage[k] = v
    },
    removeItem: (k) => {
      delete memoryLocalStorage[k]
    },
  }
}

function getSessionStore(): {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
} {
  const holder = globalThis as { sessionStorage?: Storage }
  if (holder.sessionStorage) {
    return holder.sessionStorage
  }
  return {
    getItem: (k) => memorySessionStorage[k] ?? null,
    setItem: (k, v) => {
      memorySessionStorage[k] = v
    },
    removeItem: (k) => {
      delete memorySessionStorage[k]
    },
  }
}

/**
 * Resets in-memory storage (for testing).
 */
export function _resetSpotifyAuthMemoryStoreForTesting(): void {
  memoryLocalStorage = {}
  memorySessionStorage = {}
}

/**
 * Directly writes or clears the stored session (for testing only).
 */
export function _setSpotifySessionForTesting(session: SpotifySession | null): void {
  if (!session) {
    getLocalStore().removeItem(SPOTIFY_SESSION_STORAGE_KEY)
  } else {
    getLocalStore().setItem(SPOTIFY_SESSION_STORAGE_KEY, JSON.stringify(session))
  }
  notifySpotifySessionChanged()
}

/**
 * Initiates the PKCE OAuth login by generating verifier, challenge, and state,
 * storing temporary verifier state, and redirecting to Spotify authorize URL.
 */
export async function initiateSpotifyLogin(options?: {
  redirectUri?: string
  scopes?: string[]
  envOverride?: Record<string, string | undefined>
  showDialog?: boolean
}): Promise<string> {
  const clientId = getSpotifyClientId(options?.envOverride)
  if (!clientId) {
    throw new SpotifyAuthError(
      'Spotify Client ID is not configured. Set VITE_SPOTIFY_CLIENT_ID in your environment.',
      { code: 'MISSING_CLIENT_ID' },
    )
  }

  const redirectUri = options?.redirectUri || getSpotifyRedirectUri()
  const scopes = options?.scopes || [...SPOTIFY_DEFAULT_SCOPES]

  const codeVerifier = generateCodeVerifier(64)
  const codeChallenge = await generateCodeChallenge(codeVerifier)
  const state = generateOAuthState(32)

  // Save verifier, state, and requested scopes in session storage
  const pkceData: StoredPKCEState = {
    codeVerifier,
    state,
    redirectUri,
    scopes,
    createdAt: Date.now(),
  }
  getSessionStore().setItem(SPOTIFY_PKCE_STATE_KEY, JSON.stringify(pkceData))

  const authUrl = new URL(SPOTIFY_AUTH_ENDPOINT)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('scope', scopes.join(' '))
  authUrl.searchParams.set('show_dialog', options?.showDialog === false ? 'false' : 'true')

  const destination = authUrl.toString()
  if (typeof window !== 'undefined' && window.location?.assign) {
    window.location.assign(destination)
  }

  return destination
}

/**
 * Validates and completes OAuth callback parameters, exchanges authorization code for tokens,
 * and saves session.
 */
export async function handleSpotifyCallback(
  paramsInput: URLSearchParams | string,
  options?: {
    redirectUri?: string
    envOverride?: Record<string, string | undefined>
    fetchFn?: typeof fetch
  },
): Promise<SpotifySession> {
  const params =
    typeof paramsInput === 'string'
      ? new URLSearchParams(paramsInput.startsWith('?') ? paramsInput.slice(1) : paramsInput)
      : paramsInput

  // Check error parameters from Spotify
  const errorParam = params.get('error')
  if (errorParam) {
    if (errorParam === 'access_denied') {
      throw new SpotifyAuthError(
        'Spotify authorization was denied or cancelled by the user.',
        { code: 'ACCESS_DENIED' },
      )
    }
    throw new SpotifyAuthError(
      `Spotify authorization failed: ${errorParam}`,
      { code: 'AUTH_FAILED' },
    )
  }

  const returnedState = params.get('state')
  const code = params.get('code')

  if (!returnedState || !code) {
    throw new SpotifyAuthError(
      'Malformed OAuth callback: missing required "code" or "state" parameters.',
      { code: 'MALFORMED_CALLBACK' },
    )
  }

  // Retrieve stored PKCE state
  const rawStoredState = getSessionStore().getItem(SPOTIFY_PKCE_STATE_KEY)
  if (!rawStoredState) {
    throw new SpotifyAuthError(
      'No pending Spotify authorization request found. Please log in again.',
      { code: 'NO_PENDING_AUTH' },
    )
  }

  let storedState: StoredPKCEState
  try {
    storedState = JSON.parse(rawStoredState) as StoredPKCEState
  } catch {
    getSessionStore().removeItem(SPOTIFY_PKCE_STATE_KEY)
    throw new SpotifyAuthError(
      'Corrupted PKCE authorization state. Please try logging in again.',
      { code: 'INVALID_STATE_PAYLOAD' },
    )
  }

  // Validate state against CSRF
  if (storedState.state !== returnedState) {
    getSessionStore().removeItem(SPOTIFY_PKCE_STATE_KEY)
    throw new SpotifyAuthError(
      'OAuth state mismatch detected. Request may have been tampered with or expired.',
      { code: 'STATE_MISMATCH' },
    )
  }

  const clientId = getSpotifyClientId(options?.envOverride)
  if (!clientId) {
    throw new SpotifyAuthError('Spotify Client ID is missing.', { code: 'MISSING_CLIENT_ID' })
  }

  const redirectUri = options?.redirectUri || storedState.redirectUri

  // Exchange code for tokens
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: storedState.codeVerifier,
  })

  const customFetch = options?.fetchFn || globalThis.fetch
  const tokenResponse = await customFetch(SPOTIFY_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })

  if (!tokenResponse.ok) {
    let errorDesc = `Token exchange failed with status ${tokenResponse.status}`
    try {
      const errorPayload = (await tokenResponse.json()) as SpotifyAuthErrorPayload
      if (errorPayload.error_description) {
        errorDesc = errorPayload.error_description
      } else if (errorPayload.error) {
        errorDesc = errorPayload.error
      }
    } catch {
      // Ignore JSON parse error and use default
    }
    throw new SpotifyAuthError(errorDesc, {
      code: 'TOKEN_EXCHANGE_FAILED',
      status: tokenResponse.status,
    })
  }

  const tokenData = (await tokenResponse.json()) as SpotifyTokenResponse

  // RFC 6749 §5.1: `scope` is OPTIONAL if identical to the scope requested.
  // When returned, respect the server's granted set (even if restricted).
  // Only fall back to requested scopes when the parameter was omitted entirely.
  const grantedScope =
    tokenData.scope !== undefined && tokenData.scope !== null
      ? tokenData.scope
      : (storedState.scopes?.join(' ') ?? SPOTIFY_DEFAULT_SCOPES.join(' '))

  const now = Date.now()
  const session: SpotifySession = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: now + tokenData.expires_in * 1000,
    issuedAt: now,
    scope: grantedScope,
  }

  // Attempt to fetch user profile for display name / avatar
  try {
    const profileResponse = await customFetch(`${SPOTIFY_API_BASE_URL}/me`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    })
    if (profileResponse.ok) {
      const p = await profileResponse.json()
      session.user = {
        id: p.id,
        displayName: p.display_name || p.id,
        email: p.email,
        product: p.product,
        country: p.country,
        imageUrl: p.images?.[0]?.url,
        profileUrl: p.external_urls?.spotify,
      }
    }
  } catch {
    // Non-fatal if profile lookup fails
  }

  // Store session in localStorage
  getLocalStore().setItem(SPOTIFY_SESSION_STORAGE_KEY, JSON.stringify(session))
  notifySpotifySessionChanged()

  // Clean up temporary session state
  getSessionStore().removeItem(SPOTIFY_PKCE_STATE_KEY)

  return session
}

/**
 * Returns current Spotify session from local storage, or null if none exists.
 */
export function getSpotifySession(): SpotifySession | null {
  const raw = getLocalStore().getItem(SPOTIFY_SESSION_STORAGE_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw) as SpotifySession
  } catch {
    getLocalStore().removeItem(SPOTIFY_SESSION_STORAGE_KEY)
    notifySpotifySessionChanged()
    return null
  }
}

/**
 * Checks if user is currently connected to Spotify.
 */
export function isSpotifyConnected(): boolean {
  return getSpotifySession() !== null
}

/**
 * True when a stored session exists AND it carries the scopes the Web Playback
 * SDK needs (`streaming`, `user-modify-playback-state`). An existing session
 * authorized before the playback scopes were introduced reports false here —
 * the user must reconnect to re-consent; their old token is never treated as
 * if it already had the new permission.
 */
export function isSpotifyPlaybackAuthorized(): boolean {
  const session = getSpotifySession()
  if (!session) return false

  return spotifyScopesIncludePlaybackScopes(session.scope)
}

/**
 * Disconnects Spotify account and clears session and verifiers.
 */
export function disconnectSpotify(): void {
  getLocalStore().removeItem(SPOTIFY_SESSION_STORAGE_KEY)
  getSessionStore().removeItem(SPOTIFY_PKCE_STATE_KEY)
  notifySpotifySessionChanged()
}

/**
 * Retrieves a valid Spotify access token. If token is close to expiring,
 * it refreshes using the refresh token. If refresh token has exceeded the
 * 6-month limit or is invalid, expires the session.
 */
export async function getValidSpotifyAccessToken(options?: {
  envOverride?: Record<string, string | undefined>
  fetchFn?: typeof fetch
}): Promise<string | null> {
  const session = getSpotifySession()
  if (!session) return null

  const now = Date.now()

  // If token is valid for more than 60 seconds, return it
  if (session.expiresAt - now > 60_000) {
    return session.accessToken
  }

  // If no refresh token is present, session cannot be refreshed
  if (!session.refreshToken) {
    disconnectSpotify()
    return null
  }

  // Enforce 6-month (180 days) maximum age limit on refresh tokens
  const tokenAge = now - (session.issuedAt || 0)
  if (tokenAge > SPOTIFY_REFRESH_TOKEN_MAX_AGE_MS) {
    disconnectSpotify()
    throw new SpotifyAuthError(
      'Spotify refresh token expired after 6 months. Please re-authenticate your Spotify account.',
      { code: 'REFRESH_TOKEN_EXPIRED' },
    )
  }

  const clientId = getSpotifyClientId(options?.envOverride)
  if (!clientId) {
    throw new SpotifyAuthError('Spotify Client ID is missing.', { code: 'MISSING_CLIENT_ID' })
  }

  // Execute token refresh
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken,
  })

  const customFetch = options?.fetchFn || globalThis.fetch
  let response: Response
  try {
    response = await customFetch(SPOTIFY_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    })
  } catch (err) {
    throw new SpotifyAuthError('Network error while refreshing Spotify token.', {
      code: 'NETWORK_ERROR',
      cause: err,
    })
  }

  if (!response.ok) {
    // If refresh token was revoked or invalid, clear session
    if (response.status === 400 || response.status === 401) {
      disconnectSpotify()
      throw new SpotifyAuthError(
        'Spotify session expired or was revoked. Please reconnect your Spotify account.',
        { code: 'REFRESH_REVOKED', status: response.status },
      )
    }

    throw new SpotifyAuthError(
      `Failed to refresh Spotify token (HTTP ${response.status}).`,
      { code: 'REFRESH_FAILED', status: response.status },
    )
  }

  const refreshed = (await response.json()) as SpotifyTokenResponse

  const updatedSession: SpotifySession = {
    ...session,
    accessToken: refreshed.access_token,
    expiresAt: Date.now() + refreshed.expires_in * 1000,
    // Spotify may return a new refresh token or rotate it
    refreshToken: refreshed.refresh_token || session.refreshToken,
    // If a new refresh token is provided, update issuedAt
    issuedAt: refreshed.refresh_token ? Date.now() : session.issuedAt,
    scope:
      refreshed.scope !== undefined && refreshed.scope !== null
        ? refreshed.scope
        : session.scope,
  }

  getLocalStore().setItem(SPOTIFY_SESSION_STORAGE_KEY, JSON.stringify(updatedSession))
  notifySpotifySessionChanged()

  return updatedSession.accessToken
}
