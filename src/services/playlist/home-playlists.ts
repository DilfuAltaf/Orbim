import { isSharedWithViewer, playlistsByRecentUpdate, recentlyAddedTracks } from '../../data/mock/index.ts'
import type { MusicTrack, Playlist } from '../../types/music.ts'

export interface ResolveHomePlaylistsParams {
  user: { id: string } | null
  isDemo: boolean
  remotePlaylists: Playlist[]
  mockPlaylists?: Playlist[]
}

export interface HomePlaylistsResolution {
  ownPlaylists: Playlist[]
  sharedPlaylists: Playlist[]
}

/**
 * Resolves owned and shared playlists for the Home page.
 *
 * Rules:
 * 1. For authenticated users, separates remote playlists into owned (owner.id === user.id)
 *    and shared (owner.id !== user.id). Mock playlists are NEVER mixed into remote results.
 * 2. In Supabase mode (`isDemo: false`), guests receive empty arrays for both owned and shared
 *    (preventing leakage of private remote data and avoiding fake mock data).
 * 3. In Demo mode (`isDemo: true`), guests receive mock playlists categorized by viewer ownership.
 * 4. Fetch errors (remotePlaylists = []) must resolve to empty arrays, never falling back to mock data.
 */
export function resolveHomePlaylists({
  user,
  isDemo,
  remotePlaylists,
  mockPlaylists = [],
}: ResolveHomePlaylistsParams): HomePlaylistsResolution {
  if (user) {
    const sorted = [...remotePlaylists].sort((a, b) => {
      const timeA = new Date(a.updatedAt).getTime()
      const timeB = new Date(b.updatedAt).getTime()
      return (Number.isNaN(timeB) ? 0 : timeB) - (Number.isNaN(timeA) ? 0 : timeA)
    })

    const own = sorted.filter((p) => p.owner.id === user.id)
    const shared = sorted.filter((p) => p.owner.id !== user.id)

    return {
      ownPlaylists: own,
      sharedPlaylists: shared,
    }
  }

  if (isDemo) {
    const sorted = playlistsByRecentUpdate(mockPlaylists)
    const own = sorted.filter((p) => !isSharedWithViewer(p))
    const shared = sorted.filter(isSharedWithViewer)

    return {
      ownPlaylists: own,
      sharedPlaylists: shared,
    }
  }

  return {
    ownPlaylists: [],
    sharedPlaylists: [],
  }
}

export interface ResolveHomeRecentTracksParams {
  isDemo: boolean
  limit?: number
  /** Tracks read from Supabase, newest first. Used only in live mode. */
  remoteTracks?: MusicTrack[]
}

/**
 * Resolves tracks for the Home page "Recently added" section.
 *
 * Rules:
 * 1. In Demo mode (`isDemo: true`), provides the demo mock tracks for UI review.
 * 2. In Supabase mode (`isDemo: false`), returns the supplied live tracks (de-duplicated),
 *    or an empty array when none are available. Mock fixtures are never substituted.
 */
export function resolveHomeRecentTracks({
  isDemo,
  limit = 5,
  remoteTracks = [],
}: ResolveHomeRecentTracksParams): MusicTrack[] {
  if (isDemo) {
    return recentlyAddedTracks(limit)
  }

  const seen = new Set<string>()
  const tracks: MusicTrack[] = []

  for (const track of remoteTracks) {
    const key = `${track.provider}:${track.providerTrackId}`
    if (seen.has(key)) continue
    seen.add(key)
    tracks.push(track)
    if (tracks.length === limit) break
  }

  return tracks
}
