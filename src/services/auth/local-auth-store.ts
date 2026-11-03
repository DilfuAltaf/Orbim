/**
 * Local Authentication and Storage Fallback for Seamless Testing.
 *
 * Allows users to register and sign in with any valid email format (containing '@')
 * and password without relying on third-party email delivery or hitting Supabase
 * free-tier email rate limits ('over_email_send_rate_limit').
 */

export interface LocalUser {
  id: string
  email: string
  displayName: string
  password?: string
  createdAt: string
}

const LOCAL_USERS_KEY = 'orbim_local_registered_users'
const ACTIVE_USER_KEY = 'orbim_active_local_user'
const LOCAL_PLAYLISTS_KEY = 'orbim_local_user_playlists'
const LOCAL_TRACKS_KEY = 'orbim_local_playlist_tracks'

const DEFAULT_KNOWN_USERS: LocalUser[] = [
  {
    id: 'usr-admin-dilfu',
    email: 'dilfualtaf07@gmail.com',
    displayName: 'dilfualtaf07',
    createdAt: '2026-10-20T00:00:00.000Z',
  },
  {
    id: 'usr-user-dilpuu',
    email: 'dilfualtaf047@gmail.com',
    displayName: 'dilpuu',
    createdAt: '2026-11-01T00:00:00.000Z',
  },
]

export function getAllLocalUsers(): LocalUser[] {
  let list: LocalUser[] = []
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(LOCAL_USERS_KEY)
      list = raw ? (JSON.parse(raw) as LocalUser[]) : []
    } catch {
      list = []
    }
  }

  // Ensure default known users are always included
  for (const def of DEFAULT_KNOWN_USERS) {
    if (!list.some((u) => u.email.toLowerCase() === def.email.toLowerCase())) {
      list.push(def)
    }
  }

  return list
}

export function saveLocalUser(user: LocalUser): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const users = getAllLocalUsers()
      const existingIndex = users.findIndex(
        (u) => u.email.toLowerCase() === user.email.toLowerCase(),
      )
      if (existingIndex >= 0) {
        users[existingIndex] = { ...users[existingIndex], ...user }
      } else {
        users.push(user)
      }
      window.localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users))
    } catch {
      // Ignore quota restrictions
    }
  }

  // Also sync to dev server registry
  try {
    if (typeof fetch === 'function') {
      void fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user }),
      }).catch(() => null)
    }
  } catch {
    // Non-blocking
  }
}

export function findLocalUserByEmail(email: string): LocalUser | null {
  const users = getAllLocalUsers()
  const clean = email.trim().toLowerCase()
  return users.find((u) => u.email.toLowerCase() === clean) || null
}

export function getActiveLocalUser(): LocalUser | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  try {
    const raw = window.localStorage.getItem(ACTIVE_USER_KEY)
    return raw ? (JSON.parse(raw) as LocalUser) : null
  } catch {
    return null
  }
}

export function setActiveLocalUser(user: LocalUser | null): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    if (user) {
      window.localStorage.setItem(ACTIVE_USER_KEY, JSON.stringify(user))
    } else {
      window.localStorage.removeItem(ACTIVE_USER_KEY)
    }
  } catch {
    // Ignore quota restrictions
  }
}

// ---------------------------------------------------------------------------
// Local Playlist Store for Local Users
// ---------------------------------------------------------------------------

export interface LocalPlaylistRecord {
  id: string
  owner_id: string
  title: string
  description: string | null
  visibility: 'private' | 'shared'
  created_at: string
  updated_at: string
}

export interface LocalPlaylistTrackRecord {
  id: string
  playlist_id: string
  provider: string
  provider_track_id: string
  title: string
  artist_name: string
  album_name: string | null
  artwork_url: string | null
  duration_seconds: number
  position: number
  added_by: string
  added_via: string
  verification_status: 'unverified' | 'verified' | 'rejected'
  audio_url: string | null
  storage_path: string | null
  audio_source_type: string
  catalog_track_id: string | null
  created_at: string
}

export function getLocalPlaylists(userId?: string): LocalPlaylistRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) return []
  try {
    const raw = window.localStorage.getItem(LOCAL_PLAYLISTS_KEY)
    const list: LocalPlaylistRecord[] = raw ? JSON.parse(raw) : []
    if (userId) {
      return list.filter((p) => p.owner_id === userId)
    }
    return list
  } catch {
    return []
  }
}

export function saveLocalPlaylist(playlist: LocalPlaylistRecord): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const list = getLocalPlaylists()
    const index = list.findIndex((p) => p.id === playlist.id)
    if (index >= 0) {
      list[index] = playlist
    } else {
      list.unshift(playlist)
    }
    window.localStorage.setItem(LOCAL_PLAYLISTS_KEY, JSON.stringify(list))
  } catch {
    // Ignore quota
  }
}

export function deleteLocalPlaylist(playlistId: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const list = getLocalPlaylists().filter((p) => p.id !== playlistId)
    window.localStorage.setItem(LOCAL_PLAYLISTS_KEY, JSON.stringify(list))
    // Also delete tracks
    const tracks = getLocalPlaylistTracks().filter((t) => t.playlist_id !== playlistId)
    window.localStorage.setItem(LOCAL_TRACKS_KEY, JSON.stringify(tracks))
  } catch {
    // Ignore quota
  }
}

export function getLocalPlaylistTracks(playlistId?: string): LocalPlaylistTrackRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) return []
  try {
    const raw = window.localStorage.getItem(LOCAL_TRACKS_KEY)
    const list: LocalPlaylistTrackRecord[] = raw ? JSON.parse(raw) : []
    if (playlistId) {
      return list.filter((t) => t.playlist_id === playlistId)
    }
    return list
  } catch {
    return []
  }
}

export function saveLocalPlaylistTrack(track: LocalPlaylistTrackRecord): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const list = getLocalPlaylistTracks()
    const idx = list.findIndex(
      (t) =>
        t.id === track.id ||
        (t.playlist_id === track.playlist_id && t.provider_track_id === track.provider_track_id),
    )
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...track }
    } else {
      list.push(track)
    }
    window.localStorage.setItem(LOCAL_TRACKS_KEY, JSON.stringify(list))
  } catch {
    // Ignore quota
  }
}

export function removeLocalPlaylistTrack(trackId: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const list = getLocalPlaylistTracks().filter((t) => t.id !== trackId)
    window.localStorage.setItem(LOCAL_TRACKS_KEY, JSON.stringify(list))
  } catch {
    // Ignore quota
  }
}
