import { isOwnedByViewer } from '../../data/mock/index.ts'
import type { Playlist } from '../../types/music.ts'

export interface ResolveSidebarPlaylistsParams {
  user: { id: string } | null
  isDemo: boolean
  remotePlaylists: Playlist[]
  mockPlaylists?: Playlist[]
  limit?: number
}

/**
 * Resolves the playlist list for display in the sidebar.
 *
 * Rules:
 * 1. For authenticated users, selects up to `limit` (default 4) playlists owned by the user,
 *    sorted by recent update (newest first).
 * 2. In Supabase mode (`isDemo: false`), guests receive an empty list (never private remote data,
 *    never mock playlists).
 * 3. In Demo mode (`isDemo: true`), guests receive up to `limit` demo playlists owned by the demo viewer.
 * 4. Never mixes mock playlists with an authenticated user's remote playlists.
 * 5. Fetch errors must not trigger fallback to mock playlists.
 */
export function resolveSidebarPlaylists({
  user,
  isDemo,
  remotePlaylists,
  mockPlaylists = [],
  limit = 4,
}: ResolveSidebarPlaylistsParams): Playlist[] {
  if (user) {
    const owned = remotePlaylists.filter((p) => p.owner.id === user.id)
    const sorted = [...owned].sort((a, b) => {
      const timeA = new Date(a.updatedAt).getTime()
      const timeB = new Date(b.updatedAt).getTime()
      return (Number.isNaN(timeB) ? 0 : timeB) - (Number.isNaN(timeA) ? 0 : timeA)
    })
    return sorted.slice(0, limit)
  }

  if (isDemo) {
    const demoOwned = mockPlaylists.filter(isOwnedByViewer)
    const sorted = [...demoOwned].sort((a, b) => {
      const timeA = new Date(a.updatedAt).getTime()
      const timeB = new Date(b.updatedAt).getTime()
      return (Number.isNaN(timeB) ? 0 : timeB) - (Number.isNaN(timeA) ? 0 : timeA)
    })
    return sorted.slice(0, limit)
  }

  return []
}
