/**
 * Administrator Role & Platform Authority Helper.
 *
 * Enforces admin authority for music catalog operations, track contributions,
 * and audio file uploads to Supabase Storage.
 */

export const ADMIN_EMAILS: readonly string[] = [
  'dilfualtaf07@gmail.com',
  'orbim@admin.com',
] as const

/**
 * Checks whether an email address belongs to an authorized platform administrator.
 */
export function isUserAdmin(email?: string | null): boolean {
  if (!email || typeof email !== 'string') return false
  return ADMIN_EMAILS.includes(email.toLowerCase().trim())
}
