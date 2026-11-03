/**
 * Shared playlist-invitation lifecycle.
 *
 * Both invitation methods (link and username) are backed by the same record and the
 * same status machine. This module is deliberately free of Supabase, DOM and fetch
 * dependencies so the server registry, the browser client and the tests all agree on
 * what a given invitation means.
 */

export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired'

export const INVITATION_STATUSES: readonly InvitationStatus[] = [
  'pending',
  'accepted',
  'declined',
  'revoked',
  'expired',
]

/**
 * Outcome categories that the UI must be able to tell apart. Only `network` and
 * `server` are recoverable, so only those may offer a Retry action.
 */
export type InvitationFailureKind =
  | 'invalid'
  | 'expired'
  | 'revoked'
  | 'declined'
  | 'already_accepted'
  | 'already_member'
  | 'wrong_account'
  | 'unauthorized'
  | 'not_authenticated'
  | 'network'
  | 'server'

export interface InvitationRecordLike {
  status?: string | null
  expiresAt?: string | null
  expires_at?: string | null
  acceptedAt?: string | null
  accepted_at?: string | null
  respondedAt?: string | null
}

const TERMINAL_STATUSES: readonly InvitationStatus[] = [
  'accepted',
  'declined',
  'revoked',
  'expired',
]

export function isTerminalStatus(status: InvitationStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

/**
 * Resolves the effective status of an invitation.
 *
 * A `pending` record whose expiry has passed is `expired` regardless of what is
 * stored, so a stale row can never be accepted. Explicit terminal statuses win.
 */
export function resolveInvitationStatus(
  invitation: InvitationRecordLike,
  now: Date | number = Date.now(),
): InvitationStatus {
  const declared = (invitation.status || '').trim().toLowerCase()
  const nowMs = typeof now === 'number' ? now : now.getTime()
  const expiresAt = invitation.expiresAt ?? invitation.expires_at ?? null
  const acceptedAt = invitation.acceptedAt ?? invitation.accepted_at ?? null

  if (declared === 'revoked') return 'revoked'
  if (declared === 'declined') return 'declined'
  if (declared === 'expired') return 'expired'

  if (declared === 'accepted' || (!declared && acceptedAt)) {
    return 'accepted'
  }

  if (expiresAt) {
    const expiresMs = new Date(expiresAt).getTime()
    if (Number.isFinite(expiresMs) && expiresMs <= nowMs) {
      return 'expired'
    }
  }

  return 'pending'
}

export function isInvitationUsable(
  invitation: InvitationRecordLike,
  now: Date | number = Date.now(),
): boolean {
  return resolveInvitationStatus(invitation, now) === 'pending'
}

/** Maps Postgres/Supabase RPC errors and registry error kinds onto one vocabulary. */
export function classifyInvitationFailure(input: {
  kind?: string | null
  code?: string | null
  message?: string | null
}): InvitationFailureKind {
  const rawKind = (input.kind || '').trim().toLowerCase()
  const known: readonly InvitationFailureKind[] = [
    'invalid',
    'expired',
    'revoked',
    'declined',
    'already_accepted',
    'already_member',
    'wrong_account',
    'unauthorized',
    'not_authenticated',
    'network',
    'server',
  ]
  if ((known as readonly string[]).includes(rawKind)) {
    return rawKind as InvitationFailureKind
  }

  const code = (input.code || '').trim().toUpperCase()
  const byCode: Record<string, InvitationFailureKind> = {
    ORB01: 'not_authenticated',
    ORB02: 'invalid',
    ORB03: 'invalid',
    ORB04: 'already_accepted',
    ORB05: 'expired',
    ORB06: 'invalid',
    ORB07: 'invalid',
    ORB08: 'invalid',
    ORB09: 'revoked',
    ORB10: 'declined',
    ORB11: 'wrong_account',
    ORB12: 'unauthorized',
    42501: 'unauthorized',
    PGRST301: 'not_authenticated',
  }
  if (code && byCode[code]) return byCode[code]

  const message = (input.message || '').toLowerCase()
  if (!message) return 'server'

  if (message.includes('failed to fetch') || message.includes('fetch failed') || message.includes('network') || message.includes('timeout') || message.includes('etimedout')) {
    return 'network'
  }
  if (message.includes('already been accepted') || message.includes('already accepted')) {
    return 'already_accepted'
  }
  if (message.includes('expired')) return 'expired'
  if (message.includes('revoked')) return 'revoked'
  if (message.includes('declined') || message.includes('rejected')) return 'declined'
  if (message.includes('another account') || message.includes('addressed to')) return 'wrong_account'
  if (message.includes('authentication required') || message.includes('not signed in') || message.includes('not_authenticated')) {
    return 'not_authenticated'
  }
  if (message.includes('permission denied') || message.includes('access denied') || message.includes('not the owner') || message.includes('only the playlist owner')) {
    return 'unauthorized'
  }
  if (message.includes('not found') || message.includes('invalid')) return 'invalid'
  return 'server'
}

/** A Retry control is only legitimate for transport/server failures. */
export function isRecoverableFailure(kind: InvitationFailureKind): boolean {
  return kind === 'network' || kind === 'server'
}

/** User-facing copy (the invitation surfaces are Indonesian in this build). */
export const INVITATION_FAILURE_MESSAGES: Record<InvitationFailureKind, string> = {
  invalid: 'Undangan tidak ditemukan atau tautan tidak valid.',
  expired: 'Undangan ini sudah kedaluwarsa. Minta tautan baru dari pemilik playlist.',
  revoked: 'Undangan ini telah dicabut oleh pemilik playlist.',
  declined: 'Undangan ini sudah ditolak.',
  already_accepted: 'Tautan undangan ini sudah dipakai oleh akun lain.',
  already_member: 'Anda sudah menjadi kolaborator playlist ini.',
  wrong_account: 'Undangan ini ditujukan untuk akun ORBIM lain. Masuk dengan akun yang diundang.',
  unauthorized: 'Hanya pemilik playlist yang dapat melakukan tindakan ini.',
  not_authenticated: 'Masuk ke ORBIM terlebih dahulu untuk menerima undangan.',
  network: 'Tidak dapat menghubungi server. Periksa koneksi Anda lalu coba lagi.',
  server: 'Terjadi kesalahan pada server saat memproses undangan.',
}

export function invitationFailureMessage(kind: InvitationFailureKind): string {
  return INVITATION_FAILURE_MESSAGES[kind] ?? INVITATION_FAILURE_MESSAGES.server
}

/**
 * Canonical deduplication for username search.
 *
 * Raw sources are merged by canonical user id first, then by a stable identity key
 * (email, falling back to display name). When the same person exists under several
 * ids — for example a local fallback id and a Supabase profile uuid — the
 * highest-priority record supplies the canonical id. The result can therefore never
 * contain the same account twice.
 */
export interface CandidateLike {
  id: string
  displayName: string
  email?: string | null
  avatarUrl?: string | null
  location?: string | null
  priority?: number
}

export function canonicalIdentityKeys(candidate: CandidateLike): string[] {
  const keys: string[] = []
  const id = (candidate.id || '').trim().toLowerCase()
  if (id) keys.push(`id:${id}`)
  const email = (candidate.email || '').trim().toLowerCase()
  if (email) keys.push(`email:${email}`)
  const name = (candidate.displayName || '').trim().toLowerCase()
  if (name) keys.push(`name:${name}`)
  return keys
}

export function dedupeCandidates<T extends CandidateLike>(records: T[]): T[] {
  const ranked = [...records]
    .filter((r) => Boolean(r && r.id && r.displayName))
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))

  const merged: T[] = []
  const groupOf: string[] = []
  const identityToGroup = new Map<string, number>()

  for (const record of ranked) {
    const keys = canonicalIdentityKeys(record)
    let groupIndex = -1
    for (const key of keys) {
      const existing = identityToGroup.get(key)
      if (existing !== undefined) {
        groupIndex = existing
        break
      }
    }

    if (groupIndex === -1) {
      merged.push({ ...record })
      groupOf.push(record.id)
      groupIndex = merged.length - 1
    } else {
      const current = merged[groupIndex]
      merged[groupIndex] = {
        ...current,
        avatarUrl: current.avatarUrl || record.avatarUrl || null,
        location: current.location || record.location || null,
        email: current.email || record.email || null,
      } as T
    }

    for (const key of keys) {
      identityToGroup.set(key, groupIndex)
    }
  }

  // Defensive: a single canonical id must never surface twice.
  const seenIds = new Set<string>()
  return merged.filter((candidate) => {
    if (seenIds.has(candidate.id)) return false
    seenIds.add(candidate.id)
    return true
  })
}

/** Invitation inbox item shape shared by the RPC, the dev server and the UI. */
export interface InvitationInboxItem {
  id: string
  invitationId: string
  playlistId: string
  playlistTitle: string
  inviterUserId?: string
  inviterDisplayName: string
  inviteeUserId?: string | null
  inviteeDisplayName?: string | null
  role: string
  status: InvitationStatus
  createdAt: string
  expiresAt: string
  respondedAt?: string | null
  delivery: 'link' | 'account'
}

export function isInboxItemPending(item: InvitationInboxItem): boolean {
  return item.status === 'pending'
}

/** Maps a lifecycle status onto the notification bell's status vocabulary. */
export function toNotificationStatus(status: InvitationStatus): 'pending' | 'accepted' | 'declined' {
  if (status === 'accepted') return 'accepted'
  if (status === 'declined') return 'declined'
  return 'pending'
}
