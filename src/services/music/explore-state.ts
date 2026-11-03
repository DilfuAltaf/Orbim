import type { MusicTrack } from '../../types/music.ts'

/**
 * Explore is a Spotify discovery surface. Its UI state is derived here, in a pure
 * function, so loading / empty / error / unauthenticated behaviour can be tested
 * without a DOM.
 */
export type ExploreSearchStateKind =
  | 'demo'
  | 'not-configured'
  | 'disconnected'
  | 'idle'
  | 'searching'
  | 'error'
  | 'empty'
  | 'results'

export interface ExploreSearchInput {
  /** Explicit demo mode serves the offline fixture catalog, never live Spotify data. */
  isDemo: boolean
  /** Whether a Spotify Client ID is available to the browser. */
  isSpotifyConfigured: boolean
  /** Whether a Spotify PKCE session with a refreshable token exists. */
  isSpotifyConnected: boolean
  /** Current debounced query. Spotify search requires a non-empty query. */
  query: string
  isLoading: boolean
  error: string | null
  results: MusicTrack[]
}

export interface ExploreSearchState {
  kind: ExploreSearchStateKind
  results: MusicTrack[]
  error: string | null
  canRetry: boolean
}

const EMPTY: MusicTrack[] = []

/**
 * Resolves Explore's presentation state.
 *
 * Precedence:
 * 1. Explicit demo mode wins — fixtures are served regardless of Spotify state.
 * 2. Missing Client ID (misconfiguration) is reported before the connect prompt.
 * 3. A configured-but-disconnected Spotify account prompts PKCE authorization.
 * 4. An empty query is idle: Spotify search has no browse-all endpoint.
 * 5. In-flight requests win over previous errors/results.
 * 6. A failed request is an error with retry — never an empty catalog.
 * 7. Zero results for a real query is an honest empty state.
 */
export function resolveExploreSearchState(input: ExploreSearchInput): ExploreSearchState {
  if (input.isDemo) {
    return { kind: 'demo', results: input.results, error: null, canRetry: false }
  }

  if (!input.isSpotifyConfigured) {
    return { kind: 'not-configured', results: EMPTY, error: null, canRetry: false }
  }

  if (!input.isSpotifyConnected) {
    return { kind: 'disconnected', results: EMPTY, error: null, canRetry: false }
  }

  if (!input.query.trim()) {
    return { kind: 'idle', results: EMPTY, error: null, canRetry: false }
  }

  if (input.isLoading) {
    return { kind: 'searching', results: EMPTY, error: null, canRetry: false }
  }

  if (input.error) {
    return { kind: 'error', results: EMPTY, error: input.error, canRetry: true }
  }

  if (input.results.length === 0) {
    return { kind: 'empty', results: EMPTY, error: null, canRetry: false }
  }

  return { kind: 'results', results: input.results, error: null, canRetry: false }
}
