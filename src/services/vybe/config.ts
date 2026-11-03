/**
 * VYBE Music Library API Configuration & Security Constants.
 *
 * Implements strict security and architectural rules:
 * - Secret keys (vybe_sec_...) must NEVER be exposed or accepted in client code.
 * - Publishable keys (vybe_pub_...) are safe for browser SDK/API calls.
 * - Session tokens (vybe_ct_...) are per-user short-lived tokens.
 * - Stream URLs have a documented 6-hour lifetime.
 * - Attribution text is strictly "Music from VYBE".
 */

import type { VybeCredentialType, VybeUsageEvent, VybeUsageEventType, VybeUsagePayload } from './types.ts'

export const VYBE_API_BASE_URL = 'https://vybemusic.com/api/library/v1'
export const VYBE_USAGE_ENDPOINT = 'https://vybemusic.com/api/library/v1/usage'
export const VYBE_ATTRIBUTION_TEXT = 'Music from VYBE'
export const VYBE_LEGAL_URL = 'https://www.vybemusic.com/legal/library/'

/**
 * Official VYBE stream URL lifetime is 6 hours (in milliseconds).
 */
export const VYBE_STREAM_URL_LIFETIME_MS = 6 * 60 * 60 * 1000

/**
 * 5-minute safety buffer before 6-hour expiry to trigger pre-emptive refresh.
 */
export const VYBE_STREAM_EXPIRY_BUFFER_MS = 5 * 60 * 1000

/**
 * Classifies a credential string into its documented VYBE type.
 */
export function classifyVybeCredential(keyOrToken?: string | null): VybeCredentialType {
  if (typeof keyOrToken !== 'string') return 'unknown'
  const trimmed = keyOrToken.trim()

  if (trimmed.startsWith('vybe_pub_')) {
    return 'publishable_key'
  }
  if (trimmed.startsWith('vybe_sec_')) {
    return 'secret_key'
  }
  if (trimmed.startsWith('vybe_ct_')) {
    return 'session_token'
  }

  return 'unknown'
}

/**
 * Validates whether a key matches the documented Publishable Key format
 * (vybe_pub_ followed by 40+ characters).
 */
export function isValidVybePublishableKey(key?: string | null): boolean {
  if (typeof key !== 'string') return false
  return /^vybe_pub_[a-zA-Z0-9]{40,}$/.test(key.trim())
}

/**
 * Validates whether a token matches the documented Session Token format (vybe_ct_...).
 */
export function isValidVybeSessionToken(token?: string | null): boolean {
  if (typeof token !== 'string') return false
  return /^vybe_ct_[a-zA-Z0-9_-]+$/.test(token.trim())
}

/**
 * Security defense: ensures secret keys are NEVER allowed into frontend code or constructors.
 * Throws an explicit error if a secret key is detected.
 */
export function assertNotVybeSecretKey(key?: string | null): void {
  if (typeof key === 'string' && key.trim().startsWith('vybe_sec_')) {
    throw new Error(
      'Security violation: VYBE secret keys (vybe_sec_...) must never be used in frontend client code.',
    )
  }
}

/**
 * Determines whether a stream URL generated at `issuedAtMs` has expired or is close to expiring.
 */
export function isVybeStreamUrlExpired(
  issuedAtMs: number,
  bufferMs: number = VYBE_STREAM_EXPIRY_BUFFER_MS,
): boolean {
  const now = Date.now()
  const age = now - issuedAtMs
  return age >= VYBE_STREAM_URL_LIFETIME_MS - bufferMs
}

/**
 * Builds an anonymous batched usage payload for POST /v1/usage.
 * Strictly verifies zero user PII is included in the payload.
 */
export function buildVybeUsagePayload(
  rawEvents: Array<{ trackId: string; event: VybeUsageEventType }>,
): VybeUsagePayload {
  const events: VybeUsageEvent[] = rawEvents
    .filter((e) => typeof e.trackId === 'string' && e.trackId.trim().length > 0)
    .map((e) => ({
      track_id: e.trackId.trim(),
      event: e.event,
    }))

  return { events }
}
