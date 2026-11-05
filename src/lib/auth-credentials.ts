/**
 * Shared registration / sign-in credential rules.
 *
 * ORBIM keeps registration simple: any identifier containing "@" is accepted.
 * No domain existence, DNS, MX, deliverability or inbox checks are performed.
 *
 * Registration and login share the same normalization so one identifier always
 * resolves to one account.
 *
 * Password handling is unchanged: a password is required and must meet the
 * minimum length enforced by the forms and the auth backend.
 */

export const MIN_PASSWORD_LENGTH = 6

export const IDENTIFIER_REQUIRED_MESSAGE = 'Enter an email or identifier.'
export const IDENTIFIER_MISSING_AT_MESSAGE =
  'Include an @ in your email or identifier (for example you@example.com).'
export const PASSWORD_REQUIRED_MESSAGE = 'Enter a password.'
export const PASSWORD_TOO_SHORT_MESSAGE = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
export const DUPLICATE_ACCOUNT_MESSAGE =
  'An account with this email or identifier already exists. Sign in instead.'

/**
 * Trims surrounding whitespace and lowercases the identifier.
 * Lowercasing matches how email identifiers are stored by the auth backends, so
 * `ABC@Gmail.com` and `abc@gmail.com` are the same account.
 */
export function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Minimal identifier rule: required, and must contain at least one "@".
 * Returns a user-facing error message, or null when the identifier is valid.
 */
export function validateIdentifier(value: string): string | null {
  const normalized = normalizeIdentifier(value)
  if (!normalized) return IDENTIFIER_REQUIRED_MESSAGE
  if (!normalized.includes('@')) return IDENTIFIER_MISSING_AT_MESSAGE
  return null
}

/**
 * Password rule shared by the registration form and the auth provider.
 * Returns a user-facing error message, or null when the password is acceptable.
 */
export function validateNewPassword(value: string): string | null {
  if (!value) return PASSWORD_REQUIRED_MESSAGE
  if (value.length < MIN_PASSWORD_LENGTH) return PASSWORD_TOO_SHORT_MESSAGE
  return null
}
