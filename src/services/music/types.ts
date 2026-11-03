import type { MusicTrack, TrackProvider } from '../../types/music.ts'

export interface TrackSearchOptions {
  limit?: number
  offset?: number
  genre?: string | null
  signal?: AbortSignal
}

export interface MusicProvider {
  readonly id: TrackProvider
  readonly name: string
  searchTracks(query: string, options?: TrackSearchOptions): Promise<MusicTrack[]>
  getTrack(trackId: string, options?: { signal?: AbortSignal }): Promise<MusicTrack | null>
}

export class MusicProviderError extends Error {
  readonly provider: TrackProvider
  readonly code?: number | string
  readonly status?: number
  readonly isNetworkError: boolean

  constructor(
    message: string,
    options: {
      provider: TrackProvider
      code?: number | string
      status?: number
      isNetworkError?: boolean
      cause?: unknown
    },
  ) {
    super(message)
    this.name = 'MusicProviderError'
    this.provider = options.provider
    this.code = options.code
    this.status = options.status
    this.isNetworkError = options.isNetworkError ?? false
    if (options.cause !== undefined) {
      this.cause = options.cause
    }
  }
}
