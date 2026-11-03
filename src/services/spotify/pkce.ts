/**
 * PKCE (Proof Key for Code Exchange) Utilities for Spotify OAuth.
 * RFC 7636 compliant implementation supporting browser and Node test runtimes.
 */

function getCrypto(): Crypto {
  if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    return globalThis.crypto
  }
  throw new Error('Web Cryptography API is not available in the current environment.')
}

/**
 * Base64URL encoding (RFC 4648 §5):
 * Replaces '+' with '-', '/' with '_', and strips trailing '=' padding.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }

  let base64: string
  if (typeof globalThis.btoa === 'function') {
    base64 = globalThis.btoa(binary)
  } else {
    const nodeBuffer = (globalThis as { Buffer?: { from: (arr: Uint8Array) => { toString: (enc: string) => string } } }).Buffer
    if (nodeBuffer) {
      base64 = nodeBuffer.from(bytes).toString('base64')
    } else {
      throw new Error('No base64 encoding function available in this environment.')
    }
  }

  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Generates a cryptographically random code verifier (RFC 7636 §4.1).
 * Must be 43-128 characters using [A-Z, a-z, 0-9, '-', '.', '_', '~'].
 *
 * @param length Defaults to 64 characters (recommended).
 */
export function generateCodeVerifier(length = 64): string {
  const validLength = Math.max(43, Math.min(128, length))
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const randomBytes = new Uint8Array(validLength)
  getCrypto().getRandomValues(randomBytes)

  let verifier = ''
  for (let i = 0; i < validLength; i++) {
    verifier += charset[randomBytes[i] % charset.length]
  }

  return verifier
}

/**
 * Generates S256 code challenge from the code verifier:
 * BASE64URL(SHA256(ASCII(code_verifier)))
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await getCrypto().subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(digest))
}

/**
 * Generates a cryptographically secure random state string to mitigate CSRF attacks.
 */
export function generateOAuthState(length = 32): string {
  const validLength = Math.max(16, length)
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const randomBytes = new Uint8Array(validLength)
  getCrypto().getRandomValues(randomBytes)

  let state = ''
  for (let i = 0; i < validLength; i++) {
    state += charset[randomBytes[i] % charset.length]
  }

  return state
}
