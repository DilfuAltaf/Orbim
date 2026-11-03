import type { Database } from '../../types/database.ts'
import type { Playlist, PlaylistVisibility } from '../../types/music.ts'
import { isOwnedByViewer } from '../../data/mock/index.ts'
import { getLocalPlaylistTracks } from '../auth/local-auth-store.ts'

export type SupabasePlaylistRow = Database['public']['Tables']['playlists']['Row']

export interface ResolveLibraryPlaylistsParams {
  user: { id: string } | null
  isDemo: boolean
  remotePlaylists: Playlist[]
  mockPlaylists?: Playlist[]
}

/**
 * Resolves active playlists for the Library page.
 *
 * Rules:
 * 1. Authenticated users see exclusively their remote playlists (isolated from mock demo catalog).
 * 2. Unauthenticated visitors in demo mode see the mock catalog preview.
 * 3. Unauthenticated visitors in Supabase mode receive an empty list requiring sign-in.
 * 4. Error states must not fall back to demo playlists.
 */
export function resolveLibraryPlaylists({
  user,
  isDemo,
  remotePlaylists,
  mockPlaylists = [],
}: ResolveLibraryPlaylistsParams): Playlist[] {
  if (user) {
    return remotePlaylists
  }
  if (isDemo) {
    return mockPlaylists
  }
  return []
}

/**
 * Computes owned and shared counts for library playlists.
 */
export function computeLibraryCounts(
  playlists: Playlist[],
  userId?: string | null,
): { all: number; owned: number; shared: number } {
  const isOwned = (playlist: Playlist) =>
    userId ? playlist.owner.id === userId : isOwnedByViewer(playlist)

  const owned = playlists.filter(isOwned)
  const shared = playlists.filter((playlist) => !isOwned(playlist))

  return {
    all: playlists.length,
    owned: owned.length,
    shared: shared.length,
  }
}

/**
 * Maps a raw Supabase playlist row to the UI Playlist entity.
 */
export function mapSupabasePlaylistRow(
  row: SupabasePlaylistRow,
  currentUserId: string,
  profileDisplayName?: string | null,
): Playlist {
  const localTracks = getLocalPlaylistTracks(row.id)
  const trackEntries = localTracks.map((t) => ({
    track: {
      id: t.id,
      provider: (t.provider as any) || 'orbim',
      providerTrackId: t.provider_track_id,
      title: t.title,
      artistName: t.artist_name,
      albumName: t.album_name || undefined,
      artworkUrl: t.artwork_url || undefined,
      durationSeconds: t.duration_seconds,
      isPlayable: true,
      audioSourceType: (t.audio_source_type as any) || 'none',
      audioSourceUrl: t.audio_url || undefined,
      storagePath: t.storage_path || undefined,
      verificationStatus: t.verification_status,
      attributionText: 'ORBIM Library',
      genre: 'Catalog',
      moods: [],
    },
    addedBy: {
      id: t.added_by,
      displayName: t.added_by === currentUserId ? 'You' : 'Collaborator',
      location: '',
    },
    addedAt: t.created_at,
  }))

  return {
    id: row.id,
    title: row.title,
    description: row.description || undefined,
    owner: {
      id: row.owner_id,
      displayName:
        row.owner_id === currentUserId
          ? profileDisplayName || 'You'
          : 'Collaborator',
      location: '',
    },
    visibility: row.visibility as PlaylistVisibility,
    collaborators: [],
    trackEntries,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Maps multiple Supabase playlist rows to UI Playlist entities.
 */
export function mapSupabasePlaylistRows(
  rows: SupabasePlaylistRow[],
  currentUserId: string,
  profileDisplayName?: string | null,
): Playlist[] {
  return rows.map((row) => mapSupabasePlaylistRow(row, currentUserId, profileDisplayName))
}
