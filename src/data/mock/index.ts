import { demoViewer } from './people.ts'
import { mockPlaylists } from './playlists.ts'
import { mockTracks } from './tracks.ts'
import type { MusicTrack, Playlist, PlaylistTrackEntry } from '../../types/music.ts'

/**
 * Read helpers over the demo catalog. Pages call these instead of importing the raw
 * arrays, so Phase 3 (provider) and Phase 5 (database) can swap the source without
 * rewriting components.
 */

export { ana, demoViewer, dima, june, mira } from './people.ts'
export { mockPlaylists } from './playlists.ts'
export { mockTracks, trackGenres } from './tracks.ts'

export function findPlaylist(playlistId: string): Playlist | null {
  return mockPlaylists.find((playlist) => playlist.id === playlistId) ?? null
}

export function isOwnedByViewer(playlist: Playlist): boolean {
  return playlist.owner.id === demoViewer.id
}

export function isSharedWithViewer(playlist: Playlist): boolean {
  return !isOwnedByViewer(playlist)
}

export function playlistDurationSeconds(playlist: Playlist): number {
  return playlist.trackEntries.reduce(
    (total, entry) => total + entry.track.durationSeconds,
    0,
  )
}

export function playlistTracks(playlist: Playlist): MusicTrack[] {
  return playlist.trackEntries.map((entry) => entry.track)
}

/** Newest playlist first, matching the library's default ordering. */
export function playlistsByRecentUpdate(playlists: Playlist[] = mockPlaylists): Playlist[] {
  return [...playlists].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )
}

/** Tracks that were added most recently across every playlist, de-duplicated. */
export function recentlyAddedTracks(limit = 6): MusicTrack[] {
  const entries: PlaylistTrackEntry[] = mockPlaylists
    .flatMap((playlist) => playlist.trackEntries)
    .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())

  const seen = new Set<string>()
  const tracks: MusicTrack[] = []

  for (const entry of entries) {
    if (seen.has(entry.track.providerTrackId)) continue

    seen.add(entry.track.providerTrackId)
    tracks.push(entry.track)

    if (tracks.length === limit) break
  }

  return tracks
}

export type TrackSearchOptions = {
  /** Genre chip filter; `null` means every genre. */
  genre?: string | null
}

/**
 * Local, synchronous stand-in for provider search. Matches every whitespace-separated
 * term against title, artist, album, genre and mood so "midnight lo-fi" works.
 */
export function searchTracks(query: string, options: TrackSearchOptions = {}): MusicTrack[] {
  const { genre = null } = options
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)

  return mockTracks.filter((track) => {
    if (genre && track.genre !== genre) return false
    if (terms.length === 0) return true

    const haystack = [
      track.title,
      track.artistName,
      track.albumName ?? '',
      track.genre,
      track.moods.join(' '),
    ]
      .join(' ')
      .toLowerCase()

    return terms.every((term) => haystack.includes(term))
  })
}

/** Playlists whose title, description or owner matches the query. */
export function searchPlaylists(playlists: Playlist[], query: string): Playlist[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)

  if (terms.length === 0) return playlists

  return playlists.filter((playlist) => {
    const haystack = [
      playlist.title,
      playlist.description ?? '',
      playlist.owner.displayName,
      ...playlist.collaborators.map((collaborator) => collaborator.displayName),
    ]
      .join(' ')
      .toLowerCase()

    return terms.every((term) => haystack.includes(term))
  })
}
