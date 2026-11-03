import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import {
  _resetServerTokenCacheForTesting,
  getSpotifyServerCredentials,
  getSpotifyServerToken,
  searchSpotifyTracksServer,
} from '../src/server/spotify-service.ts'

describe('Server-Side Spotify Authentication & Search Service', () => {
  beforeEach(() => {
    _resetServerTokenCacheForTesting()
  })

  it('loads server credentials from environment override', () => {
    const creds = getSpotifyServerCredentials({
      CLIENT_ID_SPOTIFY: 'test_client_id',
      CLIENT_SECRET_SPOTIFY: 'test_client_secret',
    })
    assert.equal(creds.clientId, 'test_client_id')
    assert.equal(creds.clientSecret, 'test_client_secret')
  })

  it('throws error when server credentials are completely missing', async () => {
    await assert.rejects(
      async () => {
        await getSpotifyServerToken({
          envOverride: {
            CLIENT_ID_SPOTIFY: '',
            CLIENT_SECRET_SPOTIFY: '',
            VITE_SPOTIFY_CLIENT_ID: '',
          },
        })
      },
      /Spotify server credentials missing/,
    )
  })

  it('fetches and caches client credentials token from Spotify accounts API', async () => {
    let fetchCount = 0
    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url === 'https://accounts.spotify.com/api/token') {
        fetchCount++
        assert.equal(init?.method, 'POST')
        assert.ok(String(init?.headers && (init.headers as Record<string, string>)['Authorization']).startsWith('Basic '))
        return new Response(
          JSON.stringify({
            access_token: 'mock_server_access_token_123',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('Not found', { status: 404 })
    }

    const token1 = await getSpotifyServerToken({
      envOverride: {
        CLIENT_ID_SPOTIFY: 'mock_id',
        CLIENT_SECRET_SPOTIFY: 'mock_secret',
      },
      fetchFn: mockFetch,
    })

    assert.equal(token1, 'mock_server_access_token_123')
    assert.equal(fetchCount, 1)

    // Second call should return cached token without calling fetch again
    const token2 = await getSpotifyServerToken({
      envOverride: {
        CLIENT_ID_SPOTIFY: 'mock_id',
        CLIENT_SECRET_SPOTIFY: 'mock_secret',
      },
      fetchFn: mockFetch,
    })

    assert.equal(token2, 'mock_server_access_token_123')
    assert.equal(fetchCount, 1, 'Should reuse cached token')
  })

  it('searches tracks and maps Spotify metadata cleanly without preview audio', async () => {
    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url === 'https://accounts.spotify.com/api/token') {
        return new Response(
          JSON.stringify({
            access_token: 'mock_token',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      if (url.startsWith('https://api.spotify.com/v1/search')) {
        assert.equal(
          (init?.headers as Record<string, string>)?.['Authorization'],
          'Bearer mock_token',
        )
        return new Response(
          JSON.stringify({
            tracks: {
              items: [
                {
                  id: 'track_spotify_01',
                  name: 'Clocks',
                  artists: [{ name: 'Coldplay' }],
                  album: {
                    name: 'A Rush of Blood to the Head',
                    images: [{ url: 'https://i.scdn.co/image/cover_01.jpg', width: 640, height: 640 }],
                  },
                  duration_ms: 307000,
                  external_urls: { spotify: 'https://open.spotify.com/track/track_spotify_01' },
                  explicit: false,
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      return new Response('Not found', { status: 404 })
    }

    const results = await searchSpotifyTracksServer('clocks', {
      limit: 5,
      envOverride: {
        CLIENT_ID_SPOTIFY: 'mock_id',
        CLIENT_SECRET_SPOTIFY: 'mock_secret',
      },
      fetchFn: mockFetch,
    })

    assert.equal(results.length, 1)
    const track = results[0]
    assert.equal(track.id, 'track_spotify_01')
    assert.equal(track.title, 'Clocks')
    assert.equal(track.artistName, 'Coldplay')
    assert.equal(track.albumName, 'A Rush of Blood to the Head')
    assert.equal(track.artworkUrl, 'https://i.scdn.co/image/cover_01.jpg')
    assert.equal(track.durationSeconds, 307)
    assert.equal(track.spotifyUrl, 'https://open.spotify.com/track/track_spotify_01')
    assert.equal(track.isExplicit, false)
  })

  it('returns empty array when query is whitespace', async () => {
    const results = await searchSpotifyTracksServer('   ', {
      envOverride: {
        CLIENT_ID_SPOTIFY: 'mock_id',
        CLIENT_SECRET_SPOTIFY: 'mock_secret',
      },
    })
    assert.deepEqual(results, [])
  })

  it('handles Spotify HTTP 429 rate limit correctly', async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input)
      if (url.includes('/api/token')) {
        return new Response(
          JSON.stringify({ access_token: 'mock_token', token_type: 'Bearer', expires_in: 3600 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('Rate limit', {
        status: 429,
        headers: { 'Retry-After': '12' },
      })
    }

    await assert.rejects(
      async () => {
        await searchSpotifyTracksServer('test', {
          envOverride: { CLIENT_ID_SPOTIFY: 'mock_id', CLIENT_SECRET_SPOTIFY: 'mock_secret' },
          fetchFn: mockFetch,
        })
      },
      /rate limit exceeded.*12s/,
    )
  })
})
