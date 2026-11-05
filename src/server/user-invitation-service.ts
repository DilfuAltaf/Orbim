/**
 * Server-Side User & Playlist Invitation Registry Service.
 *
 * Persists registered users, collaborator associations, and playlist invitations
 * across browser profiles, incognito windows, and device sessions during development.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  classifyInvitationFailure,
  resolveInvitationStatus,
  type InvitationFailureKind,
  type InvitationStatus,
} from '../services/playlist/invitation-lifecycle.ts'
import {
  createServerSupabaseClient,
  type SupabaseClient,
} from './supabase-server.ts'

export interface ServerUserRecord {
  id: string
  email: string
  displayName: string
  avatarUrl?: string | null
  location?: string | null
  createdAt: string
}

export interface ServerInvitationRecord {
  id: string
  /** Raw secret. Never returned by list/preview endpoints. */
  rawToken?: string
  tokenHash?: string
  playlistId: string
  role: string
  createdBy: string
  /** Canonical account id when the invitation is addressed to a specific user. */
  inviteeId?: string | null
  inviteeDisplayName?: string | null
  playlistTitle?: string
  status?: InvitationStatus
  createdAt?: string
  expiresAt: string
  respondedAt?: string | null
  acceptedAt?: string | null
  acceptedBy?: string | null
}

export interface ServerInvitationView {
  id: string
  invitationId: string
  playlistId: string
  playlistTitle: string
  inviterUserId: string
  inviterDisplayName: string
  inviteeUserId: string | null
  inviteeDisplayName: string | null
  role: string
  status: InvitationStatus
  createdAt: string
  expiresAt: string
  respondedAt: string | null
  delivery: 'link' | 'account'
}

export interface ServerInvitationResult {
  success: boolean
  status?: 'joined' | 'already_member' | 'declined'
  playlistId?: string
  playlistTitle?: string
  role?: string
  error?: string
  errorKind?: InvitationFailureKind
}

export interface ServerCreateInvitationResult {
  success: boolean
  outcome?: 'created' | 'already_invited' | 'already_member'
  invitationId?: string
  rawToken?: string
  playlistId?: string
  playlistTitle?: string
  role?: string
  error?: string
  errorKind?: InvitationFailureKind
}

export interface ServerPlaylistCollaborator {
  id: string
  playlistId: string
  userId: string
  displayName: string
  location?: string | null
  role: string
  joinedAt: string
}

export interface ServerPlaylistRecord {
  id: string
  owner_id: string
  title: string
  description?: string | null
  visibility: 'private' | 'shared'
  created_at: string
  updated_at: string
}

export interface ServerPlaylistTrackRecord {
  id: string
  playlist_id: string
  provider: string
  provider_track_id: string
  title: string
  artist_name: string
  album_name?: string | null
  artwork_url?: string | null
  duration_seconds: number
  position: number
  added_by: string
  added_via?: string
  verification_status?: string
  audio_url?: string | null
  storage_path?: string | null
  audio_source_type?: string
  catalog_track_id?: string | null
  created_at: string
}

function getUsersFilePath(): string {
  return path.resolve(process.cwd(), 'assets/users/registered-users.json')
}

function getInvitationsFilePath(): string {
  return path.resolve(process.cwd(), 'assets/users/playlist-invitations.json')
}

function getCollaboratorsFilePath(): string {
  return path.resolve(process.cwd(), 'assets/users/playlist-collaborators.json')
}

function getPlaylistsFilePath(): string {
  return path.resolve(process.cwd(), 'assets/users/playlists.json')
}

function getPlaylistTracksFilePath(): string {
  return path.resolve(process.cwd(), 'assets/users/playlist-tracks.json')
}

const DEFAULT_USERS: ServerUserRecord[] = [
  {
    id: 'usr-admin-dilfu',
    email: 'dilfualtaf07@gmail.com',
    displayName: 'dilfualtaf07',
    location: 'Jakarta, ID',
    createdAt: '2026-10-20T00:00:00.000Z',
  },
  {
    id: 'usr-user-dilpuu',
    email: 'dilfualtaf047@gmail.com',
    displayName: 'dilpuu',
    location: 'Bandung, ID',
    createdAt: '2026-11-01T00:00:00.000Z',
  },
]

let cachedUsers: ServerUserRecord[] | null = null
let cachedInvitations: ServerInvitationRecord[] | null = null
let cachedCollaborators: ServerPlaylistCollaborator[] | null = null
let cachedPlaylists: ServerPlaylistRecord[] | null = null
let cachedTracks: ServerPlaylistTrackRecord[] | null = null

let customSupabaseClientForTesting: SupabaseClient | null = null

export function _setSupabaseClientForTesting(client: SupabaseClient | null): void {
  customSupabaseClientForTesting = client
}

function getEffectiveSupabaseClient(bearerToken?: string | null): SupabaseClient | null {
  if (customSupabaseClientForTesting) {
    return customSupabaseClientForTesting
  }
  return createServerSupabaseClient(bearerToken)
}

export function computeTokenHash(token: string): string {
  return crypto.createHash('sha256').update(token.trim().toLowerCase()).digest('hex')
}

export function _resetServerStoreForTesting(): void {
  cachedUsers = null
  cachedInvitations = null
  cachedCollaborators = null
  cachedPlaylists = null
  cachedTracks = null
  customSupabaseClientForTesting = null
}

export function loadServerUsers(): ServerUserRecord[] {
  if (cachedUsers) {
    return [...cachedUsers]
  }

  try {
    const filePath = getUsersFilePath()
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8')
      const list = JSON.parse(content) as ServerUserRecord[]
      if (Array.isArray(list) && list.length > 0) {
        cachedUsers = list
        return [...list]
      }
    }
  } catch {
    // fallback
  }

  // Seed default users if file missing or empty
  cachedUsers = [...DEFAULT_USERS]
  saveServerUsers(DEFAULT_USERS)
  return [...DEFAULT_USERS]
}

export function saveServerUsers(users: ServerUserRecord[]): void {
  cachedUsers = [...users]
  try {
    const filePath = getUsersFilePath()
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(filePath, JSON.stringify(users, null, 2), 'utf8')
  } catch {
    // Non-blocking
  }
}

export function saveServerUser(user: ServerUserRecord): void {
  const current = loadServerUsers()
  const idx = current.findIndex(
    (u) =>
      u.id === user.id ||
      u.email.toLowerCase() === user.email.toLowerCase() ||
      u.displayName.toLowerCase() === user.displayName.toLowerCase(),
  )
  if (idx >= 0) {
    current[idx] = { ...current[idx], ...user }
  } else {
    current.push(user)
  }
  saveServerUsers(current)
}

export function loadServerInvitations(): ServerInvitationRecord[] {
  if (cachedInvitations) {
    return [...cachedInvitations]
  }

  try {
    const filePath = getInvitationsFilePath()
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8')
      cachedInvitations = JSON.parse(content) as ServerInvitationRecord[]
      return [...cachedInvitations]
    }
  } catch {
    // fallback
  }
  cachedInvitations = []
  return []
}

export function saveServerInvitation(invitation: ServerInvitationRecord): void {
  const current = loadServerInvitations()
  const idx = current.findIndex(
    (inv) =>
      inv.id === invitation.id ||
      (inv.rawToken && invitation.rawToken && inv.rawToken === invitation.rawToken) ||
      (inv.tokenHash && invitation.tokenHash && inv.tokenHash === invitation.tokenHash),
  )
  if (idx >= 0) {
    current[idx] = { ...current[idx], ...invitation }
  } else {
    current.push(invitation)
  }

  writeServerInvitations(current)
}

function writeServerInvitations(list: ServerInvitationRecord[]): void {
  cachedInvitations = [...list]
  try {
    const filePath = getInvitationsFilePath()
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf8')
  } catch {
    // Non-Blocking
  }
}

/** Resolves the effective lifecycle status for a registry invitation. */
export function resolveServerInvitationStatus(
  invitation: ServerInvitationRecord,
  now: Date | number = Date.now(),
): InvitationStatus {
  return resolveInvitationStatus(
    {
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      respondedAt: invitation.respondedAt,
    },
    now,
  )
}

function getServerPlaylistById(playlistId: string): ServerPlaylistRecord | null {
  return loadServerPlaylists().find((p) => p.id === playlistId) || null
}

function isServerPlaylistMember(playlistId: string, userId: string): boolean {
  const playlist = getServerPlaylistById(playlistId)
  if (!playlist) return false
  if (playlist.owner_id === userId) return true
  return loadPlaylistCollaborators(playlistId).some((c) => c.userId === userId)
}

function resolveServerDisplayName(userId: string | null | undefined): string | null {
  if (!userId) return null
  const user = loadServerUsers().find((u) => u.id === userId)
  if (user) return user.displayName
  const collaborator = loadPlaylistCollaborators().find((c) => c.userId === userId)
  return collaborator?.displayName || null
}

/** Strips secrets (raw token, token hash) and enriches a record for display. */
export function sanitizeServerInvitation(
  invitation: ServerInvitationRecord,
  now: Date | number = Date.now(),
): ServerInvitationView {
  const playlist = getServerPlaylistById(invitation.playlistId)
  const inviterName =
    resolveServerDisplayName(invitation.createdBy) || 'Pemilik Playlist'
  const inviteeName =
    invitation.inviteeDisplayName || resolveServerDisplayName(invitation.inviteeId)

  return {
    id: invitation.id,
    invitationId: invitation.id,
    playlistId: invitation.playlistId,
    playlistTitle: invitation.playlistTitle || playlist?.title || 'Playlist',
    inviterUserId: invitation.createdBy,
    inviterDisplayName: inviterName,
    inviteeUserId: invitation.inviteeId || null,
    inviteeDisplayName: inviteeName || null,
    role: invitation.role || 'editor',
    status: resolveServerInvitationStatus(invitation, now),
    createdAt: invitation.createdAt || invitation.expiresAt,
    expiresAt: invitation.expiresAt,
    respondedAt: invitation.respondedAt || invitation.acceptedAt || null,
    delivery: invitation.inviteeId ? 'account' : 'link',
  }
}

/**
 * Creates an invitation. Used by both invitation methods: a link invitation simply
 * omits `inviteeId`.
 */
export async function createServerInvitation(params: {
  playlistId: string
  createdBy: string
  inviteeId?: string | null
  inviteeDisplayName?: string | null
  rawToken?: string
  tokenHash?: string
  role?: string
  expiresAt?: string
  playlistTitle?: string
  bearerToken?: string | null
}): Promise<ServerCreateInvitationResult> {
  const playlistId = (params.playlistId || '').trim()
  const createdBy = (params.createdBy || '').trim()
  const inviteeId = (params.inviteeId || '').trim() || null

  if (!playlistId || !createdBy) {
    return { success: false, errorKind: 'invalid', error: 'Playlist and creator are required.' }
  }

  const supabase = getEffectiveSupabaseClient(params.bearerToken)
  const isProd = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'

  let playlist: ServerPlaylistRecord | null = getServerPlaylistById(playlistId)
  if (!playlist && supabase) {
    try {
      const { data: plRow } = await supabase
        .from('playlists')
        .select('id, title, owner_id, visibility, created_at, updated_at')
        .eq('id', playlistId)
        .maybeSingle()
      if (plRow) {
        playlist = {
          id: plRow.id,
          title: plRow.title,
          owner_id: plRow.owner_id,
          visibility: plRow.visibility || 'private',
          created_at: plRow.created_at,
          updated_at: plRow.updated_at,
        }
      }
    } catch {
      // non-blocking
    }
  }

  if (!playlist) {
    return {
      success: false,
      errorKind: 'invalid',
      error: 'Playlist not found. Sync the playlist before inviting collaborators.',
    }
  }

  if (playlist.owner_id !== createdBy) {
    return {
      success: false,
      errorKind: 'unauthorized',
      error: 'Only the playlist owner can invite collaborators.',
    }
  }

  if (inviteeId) {
    if (inviteeId === playlist.owner_id || isServerPlaylistMember(playlistId, inviteeId)) {
      return { success: false, outcome: 'already_member', errorKind: 'already_member', error: 'That account is already a collaborator.' }
    }

    if (supabase) {
      try {
        const { data: existingInv } = await supabase
          .from('playlist_invitations')
          .select('id, role')
          .eq('playlist_id', playlistId)
          .eq('invitee_id', inviteeId)
          .eq('status', 'pending')
          .maybeSingle()

        if (existingInv) {
          return {
            success: true,
            outcome: 'already_invited',
            invitationId: existingInv.id,
            playlistId,
            playlistTitle: playlist.title,
            role: existingInv.role || 'editor',
          }
        }
      } catch {
        // non-blocking
      }
    }

    const existingPending = loadServerInvitations().find(
      (inv) =>
        inv.playlistId === playlistId &&
        inv.inviteeId === inviteeId &&
        resolveServerInvitationStatus(inv) === 'pending',
    )
    if (existingPending) {
      return {
        success: true,
        outcome: 'already_invited',
        invitationId: existingPending.id,
        playlistId,
        playlistTitle: playlist.title,
        role: existingPending.role || 'editor',
      }
    }
  }

  const rawToken = (params.rawToken || '').trim()
  if (!rawToken && !params.tokenHash) {
    return { success: false, errorKind: 'invalid', error: 'Invitation token is required.' }
  }

  const tokenHash = params.tokenHash || (rawToken ? computeTokenHash(rawToken) : undefined)

  const expiresAt = params.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  if (!Number.isFinite(new Date(expiresAt).getTime()) || new Date(expiresAt).getTime() <= Date.now()) {
    return { success: false, errorKind: 'invalid', error: 'Invitation expiry must be in the future.' }
  }

  const invitationId = crypto.randomUUID()
  const invitation: ServerInvitationRecord = {
    id: invitationId,
    rawToken: rawToken || undefined,
    tokenHash,
    playlistId,
    playlistTitle: params.playlistTitle || playlist.title,
    role: params.role === 'editor' ? 'editor' : 'editor',
    createdBy,
    inviteeId,
    inviteeDisplayName: params.inviteeDisplayName || resolveServerDisplayName(inviteeId),
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt,
    acceptedAt: null,
    acceptedBy: null,
  }

  // Persist to Supabase if client is available
  if (supabase) {
    try {
      const { error: insertError } = await supabase
        .from('playlist_invitations')
        .insert({
          id: invitationId,
          playlist_id: playlistId,
          token_hash: tokenHash || null,
          role: 'editor',
          created_by: createdBy,
          invitee_id: inviteeId,
          status: 'pending',
          expires_at: expiresAt,
        })

      if (insertError) {
        if (isProd) {
          return {
            success: false,
            errorKind: 'server',
            error: `Failed to persist invitation in database: ${insertError.message}`,
          }
        }
      }
    } catch (err: unknown) {
      if (isProd) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
          success: false,
          errorKind: 'server',
          error: `Database error during invitation creation: ${msg}`,
        }
      }
    }
  } else if (isProd) {
    return {
      success: false,
      errorKind: 'server',
      error: 'Supabase configuration is required for invitation persistence in production.',
    }
  }

  saveServerInvitation(invitation)

  return {
    success: true,
    outcome: 'created',
    invitationId: invitation.id,
    rawToken: rawToken || undefined,
    playlistId,
    playlistTitle: invitation.playlistTitle,
    role: invitation.role,
  }
}

/**
 * Accepts an invitation from its raw link token.
 *
 * Fails closed: an unknown token is an error, never a synthetic success.
 */
export async function acceptServerInvitation(params: {
  token: string
  userId: string
  displayName?: string
  bearerToken?: string | null
}): Promise<ServerInvitationResult> {
  const { token, userId, displayName } = params
  const clean = (token || '').trim().toLowerCase()

  if (!clean || clean.length < 16) {
    return { success: false, errorKind: 'invalid', error: 'Invalid invitation token.' }
  }
  if (!userId) {
    return { success: false, errorKind: 'not_authenticated', error: 'Sign in to accept an invitation.' }
  }

  const tokenHash = computeTokenHash(clean)
  const supabase = getEffectiveSupabaseClient(params.bearerToken)
  const isProd = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'

  if (supabase) {
    try {
      if (params.bearerToken) {
        const { data: rpcData, error: rpcError } = await supabase.rpc('accept_playlist_invitation', {
          p_token: clean,
        })
        if (!rpcError && rpcData) {
          const res = rpcData as { status: string; playlist_id: string; playlist_title: string; role: string }
          return {
            success: true,
            status: res.status === 'already_member' ? 'already_member' : 'joined',
            playlistId: res.playlist_id,
            playlistTitle: res.playlist_title,
            role: res.role,
          }
        }
        if (rpcError) {
          const kind = classifyInvitationFailure({ code: rpcError.code, message: rpcError.message })
          if (kind !== 'server' && kind !== 'network') {
            return {
              success: false,
              errorKind: kind,
              error: rpcError.message,
            }
          }
        }
      }

      const { data: invRow, error: invError } = await supabase
        .from('playlist_invitations')
        .select('id, playlist_id, role, expires_at, accepted_at, status, invitee_id, created_by, playlists(id, title, owner_id)')
        .eq('token_hash', tokenHash)
        .maybeSingle()

      if (invError && isProd) {
        return {
          success: false,
          errorKind: 'server',
          error: `Database lookup error: ${invError.message}`,
        }
      }

      if (invRow) {
        const playlist = invRow.playlists as unknown as { id: string; title: string; owner_id: string } | null
        const playlistTitle = playlist?.title || 'Playlist'
        const nowMs = Date.now()
        const expiresMs = new Date(invRow.expires_at).getTime()
        const isExpired = invRow.status === 'expired' || (Number.isFinite(expiresMs) && expiresMs <= nowMs)

        if (isExpired) {
          await supabase.from('playlist_invitations').update({ status: 'expired' }).eq('id', invRow.id)
          return { success: false, errorKind: 'expired', error: 'This invitation has expired.' }
        }
        if (invRow.status === 'revoked') {
          return { success: false, errorKind: 'revoked', error: 'This invitation was revoked.' }
        }
        if (invRow.status === 'declined') {
          return { success: false, errorKind: 'declined', error: 'This invitation was declined.' }
        }
        if (invRow.status === 'accepted') {
          const { data: member } = await supabase
            .from('playlist_members')
            .select('role')
            .eq('playlist_id', invRow.playlist_id)
            .eq('user_id', userId)
            .maybeSingle()
          if (member || playlist?.owner_id === userId) {
            return {
              success: true,
              status: 'already_member',
              playlistId: invRow.playlist_id,
              playlistTitle,
              role: member?.role || (playlist?.owner_id === userId ? 'owner' : invRow.role),
            }
          }
          return {
            success: false,
            errorKind: 'already_accepted',
            error: 'This invitation link was already used by another account.',
          }
        }

        if (invRow.invitee_id && invRow.invitee_id !== userId) {
          return {
            success: false,
            errorKind: 'wrong_account',
            error: 'This invitation is addressed to another ORBIM account.',
          }
        }

        if (playlist?.owner_id === userId) {
          return {
            success: true,
            status: 'already_member',
            playlistId: invRow.playlist_id,
            playlistTitle,
            role: 'owner',
          }
        }

        const { data: existingMember } = await supabase
          .from('playlist_members')
          .select('role')
          .eq('playlist_id', invRow.playlist_id)
          .eq('user_id', userId)
          .maybeSingle()

        if (existingMember) {
          await supabase
            .from('playlist_invitations')
            .update({ status: 'accepted', accepted_at: new Date().toISOString(), accepted_by: userId, responded_at: new Date().toISOString() })
            .eq('id', invRow.id)
          return {
            success: true,
            status: 'already_member',
            playlistId: invRow.playlist_id,
            playlistTitle,
            role: existingMember.role,
          }
        }

        const nowIso = new Date().toISOString()
        const { error: updateError } = await supabase
          .from('playlist_invitations')
          .update({
            status: 'accepted',
            accepted_at: nowIso,
            accepted_by: userId,
            responded_at: nowIso,
          })
          .eq('id', invRow.id)

        if (updateError && isProd) {
          return {
            success: false,
            errorKind: 'server',
            error: `Failed to update invitation status: ${updateError.message}`,
          }
        }

        const { error: memberError } = await supabase
          .from('playlist_members')
          .upsert(
            {
              playlist_id: invRow.playlist_id,
              user_id: userId,
              role: invRow.role || 'editor',
              joined_at: nowIso,
            },
            { onConflict: 'playlist_id,user_id' },
          )

        if (memberError && isProd) {
          return {
            success: false,
            errorKind: 'server',
            error: `Failed to add member to playlist: ${memberError.message}`,
          }
        }

        await supabase
          .from('playlists')
          .update({ visibility: 'shared', updated_at: nowIso })
          .eq('id', invRow.playlist_id)

        return {
          success: true,
          status: 'joined',
          playlistId: invRow.playlist_id,
          playlistTitle,
          role: invRow.role || 'editor',
        }
      }
    } catch (err) {
      if (isProd) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
          success: false,
          errorKind: 'server',
          error: `Database acceptance error: ${msg}`,
        }
      }
    }
  } else if (isProd) {
    return {
      success: false,
      errorKind: 'server',
      error: 'Supabase configuration is required in production.',
    }
  }

  // Local development store fallback
  const current = loadServerInvitations()
  const invitation = current.find(
    (inv) =>
      (inv.rawToken && inv.rawToken.toLowerCase() === clean) ||
      (inv.tokenHash && inv.tokenHash.toLowerCase() === clean) ||
      (inv.tokenHash && inv.tokenHash.toLowerCase() === tokenHash),
  )

  if (!invitation) {
    return { success: false, errorKind: 'invalid', error: 'Invitation not found or token is invalid.' }
  }

  const playlist = getServerPlaylistById(invitation.playlistId)
  const playlistTitle = invitation.playlistTitle || playlist?.title
  const nowIso = new Date().toISOString()
  const status = resolveServerInvitationStatus(invitation)

  if (status === 'expired') {
    if (invitation.status !== 'expired') {
      invitation.status = 'expired'
      writeServerInvitations(current)
    }
    return { success: false, errorKind: 'expired', error: 'This invitation has expired.' }
  }
  if (status === 'revoked') {
    return { success: false, errorKind: 'revoked', error: 'This invitation was revoked.' }
  }
  if (status === 'declined') {
    return { success: false, errorKind: 'declined', error: 'This invitation was declined.' }
  }
  if (status === 'accepted') {
    if (isServerPlaylistMember(invitation.playlistId, userId)) {
      return {
        success: true,
        status: 'already_member',
        playlistId: invitation.playlistId,
        playlistTitle,
        role: invitation.role || 'editor',
      }
    }
    return {
      success: false,
      errorKind: 'already_accepted',
      error: 'This invitation link was already used by another account.',
    }
  }

  if (invitation.inviteeId && invitation.inviteeId !== userId) {
    return {
      success: false,
      errorKind: 'wrong_account',
      error: 'This invitation is addressed to another ORBIM account.',
    }
  }

  if (!playlist) {
    return { success: false, errorKind: 'invalid', error: 'The target playlist no longer exists.' }
  }

  if (playlist.owner_id === userId) {
    return {
      success: true,
      status: 'already_member',
      playlistId: playlist.id,
      playlistTitle,
      role: 'owner',
    }
  }

  const alreadyMember = isServerPlaylistMember(playlist.id, userId)

  invitation.status = 'accepted'
  invitation.acceptedAt = nowIso
  invitation.acceptedBy = userId
  invitation.respondedAt = nowIso
  writeServerInvitations(current)

  if (!alreadyMember) {
    addPlaylistCollaborator({
      playlistId: playlist.id,
      userId,
      displayName: displayName || 'Collaborator',
      role: invitation.role || 'editor',
    })
    playlist.visibility = 'shared'
    playlist.updated_at = nowIso
    saveServerPlaylist(playlist)
  }

  return {
    success: true,
    status: alreadyMember ? 'already_member' : 'joined',
    playlistId: playlist.id,
    playlistTitle,
    role: invitation.role || 'editor',
  }
}

/** Accepts or declines an account-addressed invitation from the recipient inbox. */
export async function respondToServerInvitation(params: {
  invitationId: string
  userId: string
  displayName?: string
  action: 'accept' | 'decline'
  bearerToken?: string | null
}): Promise<ServerInvitationResult> {
  const { invitationId, userId, displayName, action } = params
  if (!userId) {
    return { success: false, errorKind: 'not_authenticated', error: 'Sign in to respond to an invitation.' }
  }

  const supabase = getEffectiveSupabaseClient(params.bearerToken)
  const isProd = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'

  if (supabase) {
    try {
      const { data: invRow, error: invError } = await supabase
        .from('playlist_invitations')
        .select('id, playlist_id, role, status, expires_at, invitee_id, playlists(id, title, owner_id)')
        .eq('id', invitationId)
        .maybeSingle()

      if (invError && isProd) {
        return { success: false, errorKind: 'server', error: invError.message }
      }

      if (invRow) {
        if (invRow.invitee_id && invRow.invitee_id !== userId) {
          return { success: false, errorKind: 'unauthorized', error: 'This invitation belongs to another account.' }
        }
        const pl = invRow.playlists as unknown as { id: string; title: string; owner_id: string } | null
        const nowIso = new Date().toISOString()

        if (action === 'decline') {
          await supabase.from('playlist_invitations').update({ status: 'declined', responded_at: nowIso }).eq('id', invRow.id)
          return { success: true, status: 'declined', playlistId: invRow.playlist_id, playlistTitle: pl?.title }
        }

        // action === 'accept'
        await supabase
          .from('playlist_invitations')
          .update({ status: 'accepted', accepted_at: nowIso, accepted_by: userId, responded_at: nowIso })
          .eq('id', invRow.id)

        await supabase
          .from('playlist_members')
          .upsert({ playlist_id: invRow.playlist_id, user_id: userId, role: invRow.role || 'editor', joined_at: nowIso }, { onConflict: 'playlist_id,user_id' })

        await supabase.from('playlists').update({ visibility: 'shared', updated_at: nowIso }).eq('id', invRow.playlist_id)

        return {
          success: true,
          status: 'joined',
          playlistId: invRow.playlist_id,
          playlistTitle: pl?.title,
          role: invRow.role || 'editor',
        }
      }
    } catch (err) {
      if (isProd) {
        const msg = err instanceof Error ? err.message : String(err)
        return { success: false, errorKind: 'server', error: msg }
      }
    }
  } else if (isProd) {
    return { success: false, errorKind: 'server', error: 'Database persistence required in production.' }
  }

  const current = loadServerInvitations()
  const invitation = current.find((inv) => inv.id === invitationId)
  if (!invitation) {
    return { success: false, errorKind: 'invalid', error: 'Invitation not found.' }
  }

  if (invitation.inviteeId && invitation.inviteeId !== userId) {
    return { success: false, errorKind: 'unauthorized', error: 'This invitation belongs to another account.' }
  }

  const playlist = getServerPlaylistById(invitation.playlistId)
  const playlistTitle = invitation.playlistTitle || playlist?.title
  const status = resolveServerInvitationStatus(invitation)
  const nowIso = new Date().toISOString()

  if (status === 'accepted') {
    if (action === 'accept') {
      return {
        success: true,
        status: 'already_member',
        playlistId: invitation.playlistId,
        playlistTitle,
        role: invitation.role || 'editor',
      }
    }
    return { success: false, errorKind: 'already_accepted', error: 'This invitation was already accepted.' }
  }
  if (status === 'declined') {
    if (action === 'decline') {
      return { success: true, status: 'declined', playlistId: invitation.playlistId, playlistTitle }
    }
    return { success: false, errorKind: 'declined', error: 'This invitation was declined.' }
  }
  if (status === 'expired') {
    return { success: false, errorKind: 'expired', error: 'This invitation has expired.' }
  }
  if (status === 'revoked') {
    return { success: false, errorKind: 'revoked', error: 'This invitation was revoked.' }
  }
  if (!playlist) {
    return { success: false, errorKind: 'invalid', error: 'The target playlist no longer exists.' }
  }

  if (action === 'decline') {
    invitation.status = 'declined'
    invitation.respondedAt = nowIso
    writeServerInvitations(current)
    return { success: true, status: 'declined', playlistId: playlist.id, playlistTitle }
  }

  const alreadyMember = isServerPlaylistMember(playlist.id, userId)
  invitation.status = 'accepted'
  invitation.acceptedAt = nowIso
  invitation.acceptedBy = userId
  invitation.respondedAt = nowIso
  writeServerInvitations(current)

  if (!alreadyMember && playlist.owner_id !== userId) {
    addPlaylistCollaborator({
      playlistId: playlist.id,
      userId,
      displayName: displayName || 'Collaborator',
      role: invitation.role || 'editor',
    })
    playlist.visibility = 'shared'
    playlist.updated_at = nowIso
    saveServerPlaylist(playlist)
  }

  return {
    success: true,
    status: alreadyMember || playlist.owner_id === userId ? 'already_member' : 'joined',
    playlistId: playlist.id,
    playlistTitle,
    role: invitation.role || 'editor',
  }
}

/** Resolves the identity aliases (id, email, display name) known for a caller. */
export function resolveServerUserAliases(query: UserQueryParam | undefined): Set<string> {
  const aliases = new Set<string>()
  if (!query) return aliases

  const raw: string[] = []
  if (typeof query === 'string') {
    raw.push(query)
  } else {
    if (query.userId) raw.push(query.userId)
    if (query.email) raw.push(query.email)
    if (query.displayName) raw.push(query.displayName)
  }
  for (const value of raw) {
    const clean = value.trim().toLowerCase()
    if (clean) aliases.add(clean)
  }

  for (const user of loadServerUsers()) {
    if (
      aliases.has(user.id.toLowerCase()) ||
      aliases.has(user.email.toLowerCase()) ||
      aliases.has(user.displayName.toLowerCase())
    ) {
      aliases.add(user.id.toLowerCase())
      aliases.add(user.email.toLowerCase())
      aliases.add(user.displayName.toLowerCase())
    }
  }

  return aliases
}

/**
 * Recipient inbox: every invitation addressed to a canonical account, including
 * history so accepted/declined items can be shown. Secrets are stripped.
 */
export async function listServerInvitationsForUser(
  query: UserQueryParam,
  bearerToken?: string | null,
): Promise<ServerInvitationView[]> {
  const supabase = getEffectiveSupabaseClient(bearerToken)
  const isProd = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'

  if (supabase) {
    try {
      const userId = typeof query === 'string' ? query : query?.userId
      if (userId) {
        const { data: rows, error } = await supabase
          .from('playlist_invitations')
          .select('id, playlist_id, role, status, expires_at, accepted_at, responded_at, created_by, invitee_id, created_at, playlists(id, title)')
          .eq('invitee_id', userId)
          .order('created_at', { ascending: false })

        if (!error && rows) {
          const nowMs = Date.now()
          return rows.map((row: any) => {
            const playlist = row.playlists as { id: string; title: string } | null
            const expiresMs = new Date(row.expires_at).getTime()
            let status: InvitationStatus = row.status || 'pending'
            if (status === 'pending' && Number.isFinite(expiresMs) && expiresMs <= nowMs) {
              status = 'expired'
            }
            return {
              id: row.id,
              invitationId: row.id,
              playlistId: row.playlist_id,
              playlistTitle: playlist?.title || 'Playlist',
              inviterUserId: row.created_by,
              inviterDisplayName: resolveServerDisplayName(row.created_by) || 'Pemilik Playlist',
              inviteeUserId: row.invitee_id || null,
              inviteeDisplayName: resolveServerDisplayName(row.invitee_id),
              role: row.role || 'editor',
              status,
              createdAt: row.created_at || row.expires_at,
              expiresAt: row.expires_at,
              respondedAt: row.responded_at || row.accepted_at || null,
              delivery: row.invitee_id ? 'account' : 'link',
            }
          })
        }
        if (error && isProd) {
          throw new Error(`Failed to list invitations: ${error.message}`)
        }
      }
    } catch (err) {
      if (isProd) {
        throw err
      }
    }
  } else if (isProd) {
    throw new Error('Supabase client required in production.')
  }

  const aliases = resolveServerUserAliases(query)
  if (aliases.size === 0) return []

  return loadServerInvitations()
    .filter((inv) => {
      if (!inv.inviteeId) return false
      const inviteeAliases = resolveServerUserAliases(inv.inviteeId)
      return Array.from(inviteeAliases).some((alias) => aliases.has(alias))
    })
    .map((inv) => sanitizeServerInvitation(inv))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

/** Owner view of every invitation for a playlist. Secrets are stripped. */
export async function listServerInvitationsForPlaylist(
  playlistId: string,
  callerUserId?: string,
  bearerToken?: string | null,
): Promise<{ invitations: ServerInvitationView[]; error?: string; errorKind?: InvitationFailureKind }> {
  const supabase = getEffectiveSupabaseClient(bearerToken)
  const isProd = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'

  if (supabase) {
    try {
      const { data: plRow, error: plErr } = await supabase
        .from('playlists')
        .select('id, title, owner_id')
        .eq('id', playlistId)
        .maybeSingle()

      if (plErr && isProd) {
        return { invitations: [], error: plErr.message, errorKind: 'server' }
      }

      if (plRow) {
        if (callerUserId && plRow.owner_id !== callerUserId) {
          return { invitations: [], error: 'Only the playlist owner can view invitations.', errorKind: 'unauthorized' }
        }

        const { data: rows, error: listErr } = await supabase
          .from('playlist_invitations')
          .select('id, playlist_id, role, status, expires_at, accepted_at, responded_at, created_by, invitee_id, created_at')
          .eq('playlist_id', playlistId)
          .order('created_at', { ascending: false })

        if (listErr && isProd) {
          return { invitations: [], error: listErr.message, errorKind: 'server' }
        }

        if (rows) {
          const nowMs = Date.now()
          const views: ServerInvitationView[] = rows.map((row: any) => {
            const expiresMs = new Date(row.expires_at).getTime()
            let status: InvitationStatus = row.status || 'pending'
            if (status === 'pending' && Number.isFinite(expiresMs) && expiresMs <= nowMs) {
              status = 'expired'
            }
            return {
              id: row.id,
              invitationId: row.id,
              playlistId: row.playlist_id,
              playlistTitle: plRow.title,
              inviterUserId: row.created_by,
              inviterDisplayName: resolveServerDisplayName(row.created_by) || 'Pemilik Playlist',
              inviteeUserId: row.invitee_id || null,
              inviteeDisplayName: resolveServerDisplayName(row.invitee_id),
              role: row.role || 'editor',
              status,
              createdAt: row.created_at || row.expires_at,
              expiresAt: row.expires_at,
              respondedAt: row.responded_at || row.accepted_at || null,
              delivery: row.invitee_id ? 'account' : 'link',
            }
          })
          return { invitations: views }
        }
      }
    } catch (err) {
      if (isProd) {
        const msg = err instanceof Error ? err.message : String(err)
        return { invitations: [], error: msg, errorKind: 'server' }
      }
    }
  } else if (isProd) {
    return { invitations: [], error: 'Supabase client required in production.', errorKind: 'server' }
  }

  const playlist = getServerPlaylistById(playlistId)
  if (!playlist) {
    return { invitations: [], error: 'Playlist not found.', errorKind: 'invalid' }
  }
  if (callerUserId && playlist.owner_id !== callerUserId) {
    return { invitations: [], error: 'Only the playlist owner can view invitations.', errorKind: 'unauthorized' }
  }

  return {
    invitations: loadServerInvitations()
      .filter((inv) => inv.playlistId === playlistId)
      .map((inv) => sanitizeServerInvitation(inv))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  }
}

/** Link preview: returns playlist/inviter metadata for a raw token, never the hash. */
export async function getServerInvitationPreview(
  token: string,
  callerUserId?: string,
  bearerToken?: string | null,
): Promise<{ found: boolean; invitation?: ServerInvitationView; isInvitee?: boolean; errorKind?: InvitationFailureKind }> {
  const clean = (token || '').trim().toLowerCase()
  if (!clean) return { found: false, errorKind: 'invalid' }

  const supabase = getEffectiveSupabaseClient(bearerToken)
  const isProd = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'

  if (supabase) {
    try {
      const tokenHash = computeTokenHash(clean)
      const { data: invRow, error: invError } = await supabase
        .from('playlist_invitations')
        .select('id, playlist_id, role, status, expires_at, accepted_at, responded_at, created_by, invitee_id, created_at, playlists(id, title, owner_id)')
        .eq('token_hash', tokenHash)
        .maybeSingle()

      if (invError && isProd) {
        return { found: false, errorKind: 'server' }
      }

      if (invRow) {
        const pl = invRow.playlists as unknown as { id: string; title: string; owner_id: string } | null
        const nowMs = Date.now()
        const expiresMs = new Date(invRow.expires_at).getTime()
        const isExpired = invRow.status === 'expired' || (Number.isFinite(expiresMs) && expiresMs <= nowMs)

        const effectiveStatus: InvitationStatus = isExpired
          ? 'expired'
          : (invRow.status as InvitationStatus) || 'pending'

        const invitationView: ServerInvitationView = {
          id: invRow.id,
          invitationId: invRow.id,
          playlistId: invRow.playlist_id,
          playlistTitle: pl?.title || 'Playlist',
          inviterUserId: invRow.created_by,
          inviterDisplayName: resolveServerDisplayName(invRow.created_by) || 'Pemilik Playlist',
          inviteeUserId: invRow.invitee_id || null,
          inviteeDisplayName: resolveServerDisplayName(invRow.invitee_id),
          role: invRow.role || 'editor',
          status: effectiveStatus,
          createdAt: invRow.created_at || invRow.expires_at,
          expiresAt: invRow.expires_at,
          respondedAt: invRow.responded_at || invRow.accepted_at || null,
          delivery: invRow.invitee_id ? 'account' : 'link',
        }

        if (isExpired) {
          return { found: false, errorKind: 'expired', invitation: invitationView }
        }
        if (invRow.status === 'revoked') {
          return { found: false, errorKind: 'revoked', invitation: invitationView }
        }
        if (invRow.status === 'declined') {
          return { found: false, errorKind: 'declined', invitation: invitationView }
        }
        if (invRow.status === 'accepted') {
          return { found: false, errorKind: 'already_accepted', invitation: invitationView }
        }
        if (invRow.invitee_id && callerUserId && invRow.invitee_id !== callerUserId) {
          return { found: false, errorKind: 'wrong_account', invitation: invitationView }
        }

        return {
          found: true,
          invitation: invitationView,
          isInvitee: Boolean(callerUserId && invRow.invitee_id === callerUserId),
        }
      }
    } catch (err) {
      if (isProd) {
        return { found: false, errorKind: 'server' }
      }
    }
  } else if (isProd) {
    return { found: false, errorKind: 'server' }
  }

  const invitation = loadServerInvitations().find(
    (inv) =>
      (inv.rawToken && inv.rawToken.toLowerCase() === clean) ||
      (inv.tokenHash && inv.tokenHash.toLowerCase() === clean) ||
      (inv.tokenHash && inv.tokenHash.toLowerCase() === computeTokenHash(clean)),
  )

  if (!invitation) return { found: false, errorKind: 'invalid' }

  return {
    found: true,
    invitation: sanitizeServerInvitation(invitation),
    isInvitee: Boolean(callerUserId && invitation.inviteeId === callerUserId),
  }
}

export function loadPlaylistCollaborators(playlistId?: string): ServerPlaylistCollaborator[] {
  if (cachedCollaborators) {
    if (playlistId) {
      return cachedCollaborators.filter((c) => c.playlistId === playlistId)
    }
    return [...cachedCollaborators]
  }

  try {
    const filePath = getCollaboratorsFilePath()
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8')
      const list = JSON.parse(content) as ServerPlaylistCollaborator[]
      cachedCollaborators = list
      if (playlistId) {
        return list.filter((c) => c.playlistId === playlistId)
      }
      return [...list]
    }
  } catch {
    // fallback
  }
  cachedCollaborators = []
  return []
}

export function addPlaylistCollaborator(params: {
  playlistId: string
  userId: string
  displayName: string
  location?: string | null
  role?: string
}): void {
  const current = loadPlaylistCollaborators()
  const existing = current.find(
    (c) => c.playlistId === params.playlistId && c.userId === params.userId,
  )
  if (!existing) {
    current.push({
      id: `collab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      playlistId: params.playlistId,
      userId: params.userId,
      displayName: params.displayName,
      location: params.location || '',
      role: params.role || 'editor',
      joinedAt: new Date().toISOString(),
    })
    cachedCollaborators = current

    try {
      const filePath = getCollaboratorsFilePath()
      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(filePath, JSON.stringify(current, null, 2), 'utf8')
    } catch {
      // Non-blocking
    }
  }
}

export function removePlaylistCollaborator(playlistId: string, userId: string): boolean {
  const current = loadPlaylistCollaborators()
  const filtered = current.filter(
    (c) => !(c.playlistId === playlistId && (c.userId === userId || c.id === userId)),
  )
  if (filtered.length !== current.length) {
    cachedCollaborators = filtered
    try {
      const filePath = getCollaboratorsFilePath()
      fs.writeFileSync(filePath, JSON.stringify(filtered, null, 2), 'utf8')
      return true
    } catch {
      // Non-blocking
    }
    return true
  }
  return false
}

export function loadServerPlaylists(): ServerPlaylistRecord[] {
  if (cachedPlaylists) {
    return [...cachedPlaylists]
  }

  try {
    const filePath = getPlaylistsFilePath()
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8')
      cachedPlaylists = JSON.parse(content) as ServerPlaylistRecord[]
      return [...cachedPlaylists]
    }
  } catch {
    // fallback
  }
  cachedPlaylists = []
  return []
}

export function saveServerPlaylist(playlist: ServerPlaylistRecord): void {
  const current = loadServerPlaylists()
  const idx = current.findIndex((p) => p.id === playlist.id)
  if (idx >= 0) {
    current[idx] = { ...current[idx], ...playlist, updated_at: new Date().toISOString() }
  } else {
    current.unshift(playlist)
  }
  cachedPlaylists = current

  try {
    const filePath = getPlaylistsFilePath()
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(filePath, JSON.stringify(current, null, 2), 'utf8')
  } catch {
    // Non-blocking
  }
}

export function deleteServerPlaylist(playlistId: string): void {
  const current = loadServerPlaylists().filter((p) => p.id !== playlistId)
  cachedPlaylists = current
  try {
    const filePath = getPlaylistsFilePath()
    fs.writeFileSync(filePath, JSON.stringify(current, null, 2), 'utf8')
  } catch {
    // Non-blocking
  }

  // Cascade tracks
  const remainingTracks = loadServerPlaylistTracks().filter((t) => t.playlist_id !== playlistId)
  cachedTracks = remainingTracks
  try {
    const filePath = getPlaylistTracksFilePath()
    fs.writeFileSync(filePath, JSON.stringify(remainingTracks, null, 2), 'utf8')
  } catch {
    // Non-blocking
  }

  // Cascade collaborators
  const remainingCollabs = loadPlaylistCollaborators().filter((c) => c.playlistId !== playlistId)
  cachedCollaborators = remainingCollabs
  try {
    const filePath = getCollaboratorsFilePath()
    fs.writeFileSync(filePath, JSON.stringify(remainingCollabs, null, 2), 'utf8')
  } catch {
    // Non-blocking
  }

  // Cascade invitations
  const remainingInvs = loadServerInvitations().filter((i) => i.playlistId !== playlistId)
  cachedInvitations = remainingInvs
  try {
    const filePath = getInvitationsFilePath()
    fs.writeFileSync(filePath, JSON.stringify(remainingInvs, null, 2), 'utf8')
  } catch {
    // Non-blocking
  }
}

export function loadServerPlaylistTracks(playlistId?: string): ServerPlaylistTrackRecord[] {
  if (cachedTracks) {
    if (playlistId) {
      return cachedTracks.filter((t) => t.playlist_id === playlistId)
    }
    return [...cachedTracks]
  }

  try {
    const filePath = getPlaylistTracksFilePath()
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8')
      const list = JSON.parse(content) as ServerPlaylistTrackRecord[]
      cachedTracks = list
      if (playlistId) {
        return list.filter((t) => t.playlist_id === playlistId)
      }
      return [...list]
    }
  } catch {
    // fallback
  }
  cachedTracks = []
  return []
}

export function saveServerPlaylistTrack(track: ServerPlaylistTrackRecord): void {
  const current = loadServerPlaylistTracks()
  current.push(track)
  cachedTracks = current

  try {
    const filePath = getPlaylistTracksFilePath()
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(filePath, JSON.stringify(current, null, 2), 'utf8')
  } catch {
    // Non-blocking
  }
}

export function deleteServerPlaylistTrack(playlistId: string, trackId: string): boolean {
  const current = loadServerPlaylistTracks()
  const filtered = current.filter(
    (t) => !(t.playlist_id === playlistId && (t.id === trackId || t.provider_track_id === trackId)),
  )
  const didRemove = filtered.length !== current.length
  if (didRemove) {
    cachedTracks = filtered
    try {
      const filePath = getPlaylistTracksFilePath()
      fs.writeFileSync(filePath, JSON.stringify(filtered, null, 2), 'utf8')
    } catch {
      // Non-blocking
    }
  }
  return didRemove
}

export function getFullServerPlaylist(playlistId: string): {
  playlist: ServerPlaylistRecord
  playlist_tracks: ServerPlaylistTrackRecord[]
  playlist_members: Array<{
    id: string
    playlist_id: string
    user_id: string
    role: string
    joined_at: string
  }>
} | null {
  const playlists = loadServerPlaylists()
  const found = playlists.find((p) => p.id === playlistId)
  if (!found) return null

  const tracks = loadServerPlaylistTracks(playlistId).sort(
    (a, b) => Number(a.position) - Number(b.position),
  )

  const collabs = loadPlaylistCollaborators(playlistId)
  const members = [
    {
      id: `member-${found.owner_id}`,
      playlist_id: found.id,
      user_id: found.owner_id,
      role: 'owner',
      joined_at: found.created_at,
    },
    ...collabs.map((c) => ({
      id: c.id,
      playlist_id: found.id,
      user_id: c.userId,
      role: c.role || 'editor',
      joined_at: c.joinedAt,
    })),
  ]

  return {
    playlist: found,
    playlist_tracks: tracks,
    playlist_members: members,
  }
}

export type UserQueryParam =
  | string
  | {
      userId?: string
      email?: string
      displayName?: string
    }

export function getUserServerPlaylists(userQuery?: UserQueryParam): ServerPlaylistRecord[] {
  const playlists = loadServerPlaylists()
  if (!userQuery) return playlists

  const targetIds: string[] = []
  if (typeof userQuery === 'string') {
    if (userQuery.trim()) targetIds.push(userQuery.trim().toLowerCase())
  } else {
    if (userQuery.userId?.trim()) targetIds.push(userQuery.userId.trim().toLowerCase())
    if (userQuery.email?.trim()) targetIds.push(userQuery.email.trim().toLowerCase())
    if (userQuery.displayName?.trim()) targetIds.push(userQuery.displayName.trim().toLowerCase())
  }

  if (targetIds.length === 0) return playlists

  // Expand aliases from registered server users
  try {
    const serverUsers = loadServerUsers()
    const matched = serverUsers.filter((u) =>
      targetIds.includes(u.id.toLowerCase()) ||
      targetIds.includes(u.email.toLowerCase()) ||
      targetIds.includes(u.displayName.toLowerCase()),
    )
    for (const u of matched) {
      targetIds.push(u.id.toLowerCase())
      targetIds.push(u.email.toLowerCase())
      targetIds.push(u.displayName.toLowerCase())
    }
  } catch {
    // Non-blocking
  }

  const idSet = new Set(targetIds)
  const collabs = loadPlaylistCollaborators()
  const userCollabPlaylistIds = new Set(
    collabs
      .filter(
        (c) =>
          idSet.has(c.userId.toLowerCase()) ||
          (c.displayName && idSet.has(c.displayName.toLowerCase())),
      )
      .map((c) => c.playlistId),
  )

  return playlists.filter(
    (p) =>
      idSet.has(p.owner_id.toLowerCase()) ||
      userCollabPlaylistIds.has(p.id),
  )
}

