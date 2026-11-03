import { getDataSource } from '../../lib/supabase.ts'
import { SpotifyMusicProvider } from '../spotify/spotify-provider.ts'
import { VybeMusicProvider } from '../vybe/vybe-provider.ts'
import { DatabaseMusicProvider } from './database-provider.ts'
import { MockMusicProvider } from './mock.ts'
import type { MusicProvider } from './types.ts'

export * from './types.ts'
export { DatabaseMusicProvider } from './database-provider.ts'
export { MockMusicProvider } from './mock.ts'
export { SpotifyMusicProvider } from '../spotify/spotify-provider.ts'
export { VybeMusicProvider } from '../vybe/vybe-provider.ts'

/**
 * Returns a MusicProvider instance based on explicit selection.
 *
 * Callers choose the provider:
 * - `'spotify'` — global catalog discovery (Explore in live mode).
 * - `'vybe'` — independent catalog discovery (VYBE Library).
 * - `'orbim'` — tracks saved in playlists the caller can read (saved-track lookups such as
 *   bulk-import de-duplication). This is not a global catalog.
 * - `'demo'` — offline fixtures, only when demo mode is explicitly requested.
 *
 * The mock catalog is never a silent fallback inside the Database, Spotify, or VYBE providers.
 */
export function getMusicProvider(
  explicitProvider?: 'demo' | 'orbim' | 'spotify' | 'vybe',
): MusicProvider {
  if (explicitProvider === 'spotify') {
    return new SpotifyMusicProvider()
  }

  if (explicitProvider === 'vybe') {
    return new VybeMusicProvider()
  }

  if (explicitProvider === 'demo') {
    return new MockMusicProvider()
  }

  if (explicitProvider === 'orbim') {
    return new DatabaseMusicProvider()
  }

  // Determine from environment — getDataSource() only returns 'demo' when explicitly requested
  const dataSource = getDataSource()
  if (dataSource === 'supabase') {
    return new DatabaseMusicProvider()
  }

  return new MockMusicProvider()
}
