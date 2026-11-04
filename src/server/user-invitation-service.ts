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
  resolveInvitationStatus,
  type InvitationFailureKind,
  type InvitationStatus,
} from '../services/playlist/invitation-lifecycle.ts'

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

export function loadServerUsers(): ServerUserRecord[] {
  try {
    const filePath = getUsersFilePath()
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8')
      const list = JSON.parse(content) as ServerUserRecord[]
      if (Array.isArray(list) && list.length > 0) {
        return list
      }
    }
  } catch {
    // fallback
  }

  // Seed default users if file missing or empty
  saveServerUsers(DEFAULT_USERS)
  return DEFAULT_USERS
}

export function saveServerUsers(users: ServerUserRecord[]): void {
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
  try {
    const filePath = getInvitationsFilePath()
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8')
      return JSON.parse(content) as ServerInvitationRecord[]
    }
  } catch {
    // fallback
  }
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
export function createServerInvitation(params: {
  playlistId: string
  createdBy: string
  inviteeId?: string | null
  inviteeDisplayName?: string | null
  rawToken?: string
  tokenHash?: string
  role?: string
  expiresAt?: string
  playlistTitle?: string
}): ServerCreateInvitationResult {
  const playlistId = (params.playlistId || '').trim()
  const createdBy = (params.createdBy || '').trim()
  const inviteeId = (params.inviteeId || '').trim() || null

  if (!playlistId || !createdBy) {
    return { success: false, errorKind: 'invalid', error: 'Playlist and creator are required.' }
  }

  const playlist = getServerPlaylistById(playlistId)
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
  if (!rawToken) {
    return { success: false, errorKind: 'invalid', error: 'Invitation token is required.' }
  }

  const expiresAt = params.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  if (!Number.isFinite(new Date(expiresAt).getTime()) || new Date(expiresAt).getTime() <= Date.now()) {
    return { success: false, errorKind: 'invalid', error: 'Invitation expiry must be in the future.' }
  }

  const invitation: ServerInvitationRecord = {
    id: crypto.randomUUID(),
    rawToken,
    tokenHash: params.tokenHash,
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

  saveServerInvitation(invitation)

  return {
    success: true,
    outcome: 'created',
    invitationId: invitation.id,
    rawToken,
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
export function acceptServerInvitation(params: {
  token: string
  userId: string
  displayName?: string
}): ServerInvitationResult {
  const { token, userId, displayName } = params
  const clean = (token || '').trim().toLowerCase()

  if (!clean || clean.length < 16) {
    return { success: false, errorKind: 'invalid', error: 'Invalid invitation token.' }
  }
  if (!userId) {
    return { success: false, errorKind: 'not_authenticated', error: 'Sign in to accept an invitation.' }
  }

  const current = loadServerInvitations()
  const invitation = current.find(
    (inv) =>
      (inv.rawToken && inv.rawToken.toLowerCase() === clean) ||
      (inv.tokenHash && inv.tokenHash.toLowerCase() === clean),
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

  // The owner previewing their own link must not burn it.
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
export function respondToServerInvitation(params: {
  invitationId: string
  userId: string
  displayName?: string
  action: 'accept' | 'decline'
}): ServerInvitationResult {
  const { invitationId, userId, displayName, action } = params
  if (!userId) {
    return { success: false, errorKind: 'not_authenticated', error: 'Sign in to respond to an invitation.' }
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
export function listServerInvitationsForUser(query: UserQueryParam): ServerInvitationView[] {
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
export function listServerInvitationsForPlaylist(
  playlistId: string,
  callerUserId?: string,
): { invitations: ServerInvitationView[]; error?: string; errorKind?: InvitationFailureKind } {
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
export function getServerInvitationPreview(
  token: string,
  callerUserId?: string,
): { found: boolean; invitation?: ServerInvitationView; isInvitee?: boolean; errorKind?: InvitationFailureKind } {
  const clean = (token || '').trim().toLowerCase()
  if (!clean) return { found: false, errorKind: 'invalid' }

  const invitation = loadServerInvitations().find(
    (inv) =>
      (inv.rawToken && inv.rawToken.toLowerCase() === clean) ||
      (inv.tokenHash && inv.tokenHash.toLowerCase() === clean),
  )

  if (!invitation) return { found: false, errorKind: 'invalid' }

  return {
    found: true,
    invitation: sanitizeServerInvitation(invitation),
    isInvitee: Boolean(callerUserId && invitation.inviteeId === callerUserId),
  }
}

export function loadPlaylistCollaborators(playlistId?: string): ServerPlaylistCollaborator[] {
  try {
    const filePath = getCollaboratorsFilePath()
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8')
      const list = JSON.parse(content) as ServerPlaylistCollaborator[]
      if (playlistId) {
        return list.filter((c) => c.playlistId === playlistId)
      }
      return list
    }
  } catch {
    // fallback
  }
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
    try {
      const filePath = getCollaboratorsFilePath()
      fs.writeFileSync(filePath, JSON.stringify(filtered, null, 2), 'utf8')
      return true
    } catch {
      // Non-blocking
    }
  }
  return false
}

export function loadServerPlaylists(): ServerPlaylistRecord[] {
  try {
    const filePath = getPlaylistsFilePath()
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8')
      return JSON.parse(content) as ServerPlaylistRecord[]
    }
  } catch {
    // fallback
  }
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
  try {
    const filePath = getPlaylistsFilePath()
    fs.writeFileSync(filePath, JSON.stringify(current, null, 2), 'utf8')
  } catch {
    // Non-blocking
  }

  // Cascade tracks
  try {
    const remainingTracks = loadServerPlaylistTracks().filter((t) => t.playlist_id !== playlistId)
    const filePath = getPlaylistTracksFilePath()
    fs.writeFileSync(filePath, JSON.stringify(remainingTracks, null, 2), 'utf8')
  } catch {
    // Non-blocking
  }

  // Cascade collaborators
  try {
    const remainingCollabs = loadPlaylistCollaborators().filter((c) => c.playlistId !== playlistId)
    const filePath = getCollaboratorsFilePath()
    fs.writeFileSync(filePath, JSON.stringify(remainingCollabs, null, 2), 'utf8')
  } catch {
    // Non-blocking
  }

  // Cascade invitations
  try {
    const remainingInvs = loadServerInvitations().filter((i) => i.playlistId !== playlistId)
    const filePath = getInvitationsFilePath()
    fs.writeFileSync(filePath, JSON.stringify(remainingInvs, null, 2), 'utf8')
  } catch {
    // Non-blocking
  }
}

export function loadServerPlaylistTracks(playlistId?: string): ServerPlaylistTrackRecord[] {
  try {
    const filePath = getPlaylistTracksFilePath()
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8')
      const list = JSON.parse(content) as ServerPlaylistTrackRecord[]
      if (playlistId) {
        return list.filter((t) => t.playlist_id === playlistId)
      }
      return list
    }
  } catch {
    // fallback
  }
  return []
}

export function saveServerPlaylistTrack(track: ServerPlaylistTrackRecord): void {
  const current = loadServerPlaylistTracks()
  current.push(track)

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

export function deleteServerPlaylistTrack(playlistId: string, trackId: string): void {
  const current = loadServerPlaylistTracks().filter(
    (t) => !(t.playlist_id === playlistId && t.id === trackId),
  )
  try {
    const filePath = getPlaylistTracksFilePath()
    fs.writeFileSync(filePath, JSON.stringify(current, null, 2), 'utf8')
  } catch {
    // Non-blocking
  }
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

