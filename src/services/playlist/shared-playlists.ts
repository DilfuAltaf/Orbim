import { isSharedWithViewer, playlistsByRecentUpdate } from '../../data/mock/index.ts'
import type { Playlist } from '../../types/music.ts'

export interface ResolveSharedPlaylistsParams {
  user: { id: string } | null
  isDemo: boolean
  remotePlaylists: Playlist[]
  mockPlaylists?: Playlist[]
}

/**
 * Resolves shared playlists for the SharedPage.
 *
 * Rules:
 * 1. For authenticated users, selects strictly playlists where owner.id !== user.id.
 *    Owned playlists (owner.id === user.id) are excluded so they are never labeled as shared.
 * 2. In Supabase mode (`isDemo: false`), guests receive an empty array (preventing leakage
 *    of private shared playlists and avoiding fake mock data).
 * 3. In Demo mode (`isDemo: true`), guests receive mock playlists where isSharedWithViewer is true.
 * 4. Fetch errors (remotePlaylists = []) must resolve to an empty array, never falling back to mock data.
 * 5. Mock playlists are NEVER merged into Supabase results for authenticated users or guests in Supabase mode.
 */
export function resolveSharedPlaylists({
  user,
  isDemo,
  remotePlaylists,
  mockPlaylists = [],
}: ResolveSharedPlaylistsParams): Playlist[] {
  if (isDemo) {
    return playlistsByRecentUpdate(mockPlaylists.filter(isSharedWithViewer))
  }

  if (user) {
    const shared = remotePlaylists.filter((p) => p.owner.id !== user.id)
    return [...shared].sort((a, b) => {
      const timeA = new Date(a.updatedAt).getTime()
      const timeB = new Date(b.updatedAt).getTime()
      return (Number.isNaN(timeB) ? 0 : timeB) - (Number.isNaN(timeA) ? 0 : timeA)
    })
  }

  return []
}
