import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { resolveExploreSearchState } from '../src/services/music/explore-state.ts'
import type { MusicTrack } from '../src/types/music.ts'

/**
 * Explore discovery states.
 *
 * Explore is Spotify-first: it must never present a database or fixture catalog as a
 * global catalog, and every Spotify failure must be an explicit state — never an empty
 * result list that looks like a working but empty catalog.
 */

const spotifyTrack: MusicTrack = {
  provider: 'spotify',
  providerTrackId: '4cOdK2wGLETKBW3PvgPWqT',
  title: 'Never Gonna Give You Up',
  artistName: 'Rick Astley',
  albumName: 'Whenever You Need Somebody',
  artworkUrl: 'https://i.scdn.co/image/ab67616d0000b273',
  durationSeconds: 214,
  genre: 'Spotify',
  moods: [],
  isPlayable: false,
  externalUrl: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
  attributionText: 'Spotify',
}

function baseInput(overrides: Partial<Parameters<typeof resolveExploreSearchState>[0]> = {}) {
  return {
    isDemo: false,
    isSpotifyConfigured: true,
    isSpotifyConnected: true,
    query: 'rick astley',
    isLoading: false,
    error: null as string | null,
    results: [] as MusicTrack[],
    ...overrides,
  }
}

describe('Explore search state resolution', () => {
  it('reports a missing Spotify Client ID before prompting for authorization', () => {
    const state = resolveExploreSearchState(
      baseInput({ isSpotifyConfigured: false, isSpotifyConnected: false }),
    )
    assert.equal(state.kind, 'not-configured')
    assert.equal(state.results.length, 0)
    assert.equal(state.canRetry, false)
  })

  it('prompts for PKCE authorization when configured but disconnected', () => {
    const state = resolveExploreSearchState(baseInput({ isSpotifyConnected: false }))
    assert.equal(state.kind, 'disconnected')

    // A stale query must not leak preoccupied results into the connect prompt.
    const withResults = resolveExploreSearchState(
      baseInput({ isSpotifyConnected: false, results: [spotifyTrack] }),
    )
    assert.equal(withResults.kind, 'disconnected')
    assert.equal(withResults.results.length, 0)
  })

  it('is idle when connected and no query has been entered', () => {
    assert.equal(resolveExploreSearchState(baseInput({ query: '' })).kind, 'idle')
    assert.equal(resolveExploreSearchState(baseInput({ query: '   ' })).kind, 'idle')
  })

  it('reports searching while a request is in flight, even with previous results', () => {
    const state = resolveExploreSearchState(
      baseInput({ isLoading: true, results: [spotifyTrack] }),
    )
    assert.equal(state.kind, 'searching')
    assert.equal(state.results.length, 0, 'Stale results must not render during a new search')
  })

  it('surfaces Spotify failures as an explicit retryable error, never as an empty catalog', () => {
    const state = resolveExploreSearchState(
      baseInput({ error: 'Spotify rate limit exceeded. Please wait 12 seconds.' }),
    )
    assert.equal(state.kind, 'error')
    assert.equal(state.canRetry, true)
    assert.match(state.error ?? '', /rate limit/i)
    assert.equal(state.results.length, 0)
  })

  it('returns an honest empty state when Spotify matches nothing', () => {
    const state = resolveExploreSearchState(baseInput({ results: [] }))
    assert.equal(state.kind, 'empty')
    assert.equal(state.error, null)
  })

  it('returns results for a successful search', () => {
    const state = resolveExploreSearchState(baseInput({ results: [spotifyTrack] }))
    assert.equal(state.kind, 'results')
    assert.equal(state.results.length, 1)
    assert.equal(state.results[0].provider, 'spotify')
  })

  it('keeps explicit demo mode isolated from Spotify connection state', () => {
    const state = resolveExploreSearchState(
      baseInput({
        isDemo: true,
        isSpotifyConfigured: false,
        isSpotifyConnected: false,
        query: '',
        results: [spotifyTrack],
      }),
    )
    assert.equal(state.kind, 'demo')
    assert.equal(state.results.length, 1)
  })
})
