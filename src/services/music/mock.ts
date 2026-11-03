import { mockTracks, searchTracks } from '../../data/mock/index.ts'
import type { MusicTrack } from '../../types/music.ts'
import type { MusicProvider, TrackSearchOptions } from './types.ts'

export class MockMusicProvider implements MusicProvider {
  readonly id = 'demo' as const
  readonly name = 'Demo Catalog'

  async searchTracks(query: string, options: TrackSearchOptions = {}): Promise<MusicTrack[]> {
    // Mimic slight network latency so loading states work realistically in demo mode
    await new Promise((resolve) => setTimeout(resolve, 60))
    if (options.signal?.aborted) {
      throw new DOMException('Search aborted', 'AbortError')
    }

    const filtered = searchTracks(query, { genre: options.genre })
    const offset = options.offset ?? 0
    const limit = options.limit ?? 24
    return filtered.slice(offset, offset + limit)
  }

  async getTrack(trackId: string, options?: { signal?: AbortSignal }): Promise<MusicTrack | null> {
    await new Promise((resolve) => setTimeout(resolve, 30))
    if (options?.signal?.aborted) {
      throw new DOMException('Get track aborted', 'AbortError')
    }

    const match = mockTracks.find((track) => track.providerTrackId === trackId)
    return match ?? null
  }
}
