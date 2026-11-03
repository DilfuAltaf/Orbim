import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

import {
  _resetSpotifyAuthMemoryStoreForTesting,
  _setSpotifySessionForTesting,
  disconnectSpotify,
  getSpotifyClientId,
  getSpotifyRedirectUri,
  getSpotifySession,
  getValidSpotifyAccessToken,
  handleSpotifyCallback,
  initiateSpotifyLogin,
  isSpotifyConfigured,
  isSpotifyConnected,
  isSpotifyPlaybackAuthorized,
  spotifyMissingPlaybackScopes,
  spotifyScopesIncludePlaybackScopes,
  SPOTIFY_LOCAL_DEV_REDIRECT_URI,
  SPOTIFY_MAX_SEARCH_LIMIT,
  SPOTIFY_SESSION_CHANGE_EVENT,
  SpotifyAuthError,
  SpotifyMusicProvider,
} from '../src/services/spotify/index.ts'
import {
  base64UrlEncode,
  generateCodeChallenge,
  generateCodeVerifier,
  generateOAuthState,
} from '../src/services/spotify/pkce.ts'
import { isDuplicateTrackInList } from '../src/services/playlist/add-to-playlist.ts'
import type { SpotifyTrackItem } from '../src/services/spotify/types.ts'

// ---------------------------------------------------------------------------
// 1. PKCE Generation & RFC 7636 Conformance
// ---------------------------------------------------------------------------

describe('1. Spotify PKCE Generation & RFC 7636 Conformance', () => {
  it('generates a code verifier between 43 and 128 characters', () => {
    const verifier = generateCodeVerifier(64)
    assert.equal(verifier.length, 64)
    // Only unreserved characters: [A-Z, a-z, 0-9, '-', '.', '_', '~']
    assert.match(verifier, /^[A-Za-z0-9\-._~]+$/)

    const minVerifier = generateCodeVerifier(10)
    assert.equal(minVerifier.length, 43, 'Clamps to min length of 43')

    const maxVerifier = generateCodeVerifier(200)
    assert.equal(maxVerifier.length, 128, 'Clamps to max length of 128')
  })

  it('generates an S256 code challenge with Base64URL encoding without padding', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const challenge = await generateCodeChallenge(verifier)

    // Base64url must NOT contain '+', '/', or '='
    assert.ok(!challenge.includes('+'), 'Challenge must not contain +')
    assert.ok(!challenge.includes('/'), 'Challenge must not contain /')
    assert.ok(!challenge.includes('='), 'Challenge must not contain = padding')
    assert.match(challenge, /^[A-Za-z0-9\-_]+$/)

    // Verify known RFC 7636 Appendix B test vector
    // Verifier: dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
    // SHA256 base64url: E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
    assert.equal(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('generates cryptographically random OAuth state', () => {
    const state1 = generateOAuthState(32)
    const state2 = generateOAuthState(32)
    assert.equal(state1.length, 32)
    assert.notEqual(state1, state2, 'States must be random and unique')
  })

  it('base64UrlEncode correctly handles binary data without padding', () => {
    const data = new Uint8Array([0, 1, 2, 250, 251, 255])
    const encoded = base64UrlEncode(data)
    assert.ok(!encoded.includes('+'))
    assert.ok(!encoded.includes('/'))
    assert.ok(!encoded.includes('='))
  })
})

// ---------------------------------------------------------------------------
// 2. Security & Environment Configuration
// ---------------------------------------------------------------------------

describe('2. Spotify Environment Variables & Security Constraints', () => {
  it('reads Client ID safely from VITE_SPOTIFY_CLIENT_ID or VITE_CLIENT_ID_SPOTIFY', () => {
    const id1 = getSpotifyClientId({ VITE_SPOTIFY_CLIENT_ID: 'test_client_id_1' })
    assert.equal(id1, 'test_client_id_1')

    const id2 = getSpotifyClientId({ VITE_CLIENT_ID_SPOTIFY: 'test_client_id_2' })
    assert.equal(id2, 'test_client_id_2')

    const isConf = isSpotifyConfigured({ VITE_SPOTIFY_CLIENT_ID: 'valid_id' })
    assert.equal(isConf, true)

    const notConf = isSpotifyConfigured({ VITE_SPOTIFY_CLIENT_ID: '' })
    assert.equal(notConf, false)
  })

  it('never exposes or requires CLIENT_SECRET in client authentication', async () => {
    // Calling initiateSpotifyLogin only needs client ID
    _resetSpotifyAuthMemoryStoreForTesting()
    const url = await initiateSpotifyLogin({
      envOverride: { VITE_SPOTIFY_CLIENT_ID: 'public_client_123' },
      redirectUri: SPOTIFY_LOCAL_DEV_REDIRECT_URI,
    })

    const parsed = new URL(url)
    assert.equal(parsed.searchParams.get('client_id'), 'public_client_123')
    assert.equal(parsed.searchParams.get('response_type'), 'code')
    assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256')
    // Local development must use the loopback IP literal, not `localhost`
    assert.equal(parsed.searchParams.get('redirect_uri'), SPOTIFY_LOCAL_DEV_REDIRECT_URI)
    assert.ok(parsed.searchParams.has('code_challenge'))
    assert.ok(parsed.searchParams.has('state'))
    // Confirm no client secret in query parameters
    assert.equal(parsed.searchParams.get('client_secret'), null)
  })

  it('defaults the redirect URI to the loopback IP literal for local development', async function () {
    // Node tests have no `window`; getSpotifyRedirectUri must fall back to the
    // canonical loopback URI so authorization always uses a Spotify-approved URI.
    if (typeof globalThis.window !== 'undefined') {
      this.skip()
    }
    assert.equal(getSpotifyRedirectUri(), 'http://127.0.0.1:5173/callback/spotify')

    _resetSpotifyAuthMemoryStoreForTesting()
    const url = await initiateSpotifyLogin({
      envOverride: { VITE_SPOTIFY_CLIENT_ID: 'public_client_123' },
    })
    const parsed = new URL(url)
    assert.equal(parsed.searchParams.get('redirect_uri'), SPOTIFY_LOCAL_DEV_REDIRECT_URI)
  })

  it('throws SpotifyAuthError if Client ID is missing during login initiation', async () => {
    _resetSpotifyAuthMemoryStoreForTesting()
    await assert.rejects(
      async () => {
        await initiateSpotifyLogin({
          envOverride: { VITE_SPOTIFY_CLIENT_ID: '', VITE_CLIENT_ID_SPOTIFY: '' },
        })
      },
      (err: unknown) => {
        assert.ok(err instanceof SpotifyAuthError)
        assert.equal(err.code, 'MISSING_CLIENT_ID')
        return true
      },
    )
  })
})

// ---------------------------------------------------------------------------
// 3. OAuth Callback Validation & Error Cases
// ---------------------------------------------------------------------------

describe('3. OAuth Callback Validation & CSRF Protection', () => {
  beforeEach(() => {
    _resetSpotifyAuthMemoryStoreForTesting()
  })

  it('rejects callback when user denies access (access_denied)', async () => {
    const params = new URLSearchParams({
      error: 'access_denied',
      state: 'some_state',
    })

    await assert.rejects(
      async () => {
        await handleSpotifyCallback(params)
      },
      (err: unknown) => {
        assert.ok(err instanceof SpotifyAuthError)
        assert.equal(err.code, 'ACCESS_DENIED')
        assert.match(err.message, /denied or cancelled/i)
        return true
      },
    )
  })

  it('rejects malformed callback with missing code or state', async () => {
    await assert.rejects(
      async () => {
        await handleSpotifyCallback(new URLSearchParams({ code: 'abc' }))
      },
      (err: unknown) => {
        assert.ok(err instanceof SpotifyAuthError)
        assert.equal(err.code, 'MALFORMED_CALLBACK')
        return true
      },
    )
  })

  it('rejects callback with state mismatch (CSRF defense)', async () => {
    // Initiate login to store state
    await initiateSpotifyLogin({
      envOverride: { VITE_SPOTIFY_CLIENT_ID: 'test_client' },
      redirectUri: SPOTIFY_LOCAL_DEV_REDIRECT_URI,
    })

    // Callback returns different state
    const params = new URLSearchParams({
      code: 'auth_code_123',
      state: 'attacker_forged_state',
    })

    await assert.rejects(
      async () => {
        await handleSpotifyCallback(params, {
          envOverride: { VITE_SPOTIFY_CLIENT_ID: 'test_client' },
        })
      },
      (err: unknown) => {
        assert.ok(err instanceof SpotifyAuthError)
        assert.equal(err.code, 'STATE_MISMATCH')
        return true
      },
    )
  })

  it('successfully exchanges code for tokens and saves session', async () => {
    // Initiate login
    const authUrl = await initiateSpotifyLogin({
      envOverride: { VITE_SPOTIFY_CLIENT_ID: 'test_client' },
      redirectUri: SPOTIFY_LOCAL_DEV_REDIRECT_URI,
    })
    const generatedState = new URL(authUrl).searchParams.get('state')!
    const authorizationRedirectUri = new URL(authUrl).searchParams.get('redirect_uri')!

    // Mock fetch for token exchange and user profile
    const mockFetch: typeof fetch = async (input, init) => {
      const urlStr = input.toString()
      if (urlStr.includes('/api/token')) {
        // Verify PKCE body
        const body = init?.body?.toString() || ''
        assert.ok(body.includes('grant_type=authorization_code'))
        assert.ok(body.includes('code_verifier='))
        assert.ok(body.includes('client_id=test_client'))
        assert.ok(!body.includes('client_secret'))

        // The token exchange redirect_uri must be byte-identical to the one
        // sent in the authorization request.
        const exchangeParams = new URLSearchParams(body)
        assert.equal(exchangeParams.get('redirect_uri'), authorizationRedirectUri)
        assert.equal(exchangeParams.get('redirect_uri'), SPOTIFY_LOCAL_DEV_REDIRECT_URI)

        return new Response(
          JSON.stringify({
            access_token: 'mock_access_token_123',
            token_type: 'Bearer',
            scope: 'user-read-private user-read-email',
            expires_in: 3600,
            refresh_token: 'mock_refresh_token_456',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      if (urlStr.includes('/v1/me')) {
        return new Response(
          JSON.stringify({
            id: 'spotify_user_test',
            display_name: 'Test Explorer',
            email: 'explorer@example.com',
            images: [{ url: 'https://example.com/avatar.jpg' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      return new Response('Not found', { status: 404 })
    }

    const session = await handleSpotifyCallback(
      new URLSearchParams({
        code: 'valid_auth_code',
        state: generatedState,
      }),
      {
        envOverride: { VITE_SPOTIFY_CLIENT_ID: 'test_client' },
        fetchFn: mockFetch,
      },
    )

    assert.equal(session.accessToken, 'mock_access_token_123')
    assert.equal(session.refreshToken, 'mock_refresh_token_456')
    assert.equal(session.user?.displayName, 'Test Explorer')
    assert.equal(isSpotifyConnected(), true)
  })
})

// ---------------------------------------------------------------------------
// 4. Token Expiration, Refresh & 6-Month Life Cycle
// ---------------------------------------------------------------------------

describe('4. Token Expiration, 6-Month Expiration & Refresh', () => {
  beforeEach(() => {
    _resetSpotifyAuthMemoryStoreForTesting()
  })

  it('returns valid access token directly when not expired', async () => {
    _setSpotifySessionForTesting({
      accessToken: 'valid_token_now',
      refreshToken: 'refresh_tok',
      expiresAt: Date.now() + 3600 * 1000,
      issuedAt: Date.now(),
      scope: 'user-read-private',
    })

    const token = await getValidSpotifyAccessToken()
    assert.equal(token, 'valid_token_now')
  })

  it('automatically refreshes token when expired using PKCE refresh grant', async () => {
    _setSpotifySessionForTesting({
      accessToken: 'expired_token',
      refreshToken: 'valid_refresh_token',
      expiresAt: Date.now() - 1000, // expired
      issuedAt: Date.now() - 10000,
      scope: 'user-read-private',
    })

    const mockFetch: typeof fetch = async (input, init) => {
      const urlStr = input.toString()
      if (urlStr.includes('/api/token')) {
        const body = init?.body?.toString() || ''
        assert.ok(body.includes('grant_type=refresh_token'))
        assert.ok(body.includes('refresh_token=valid_refresh_token'))
        assert.ok(!body.includes('client_secret'))

        return new Response(
          JSON.stringify({
            access_token: 'brand_new_access_token',
            token_type: 'Bearer',
            scope: 'user-read-private',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('Not found', { status: 404 })
    }

    const token = await getValidSpotifyAccessToken({
      envOverride: { VITE_SPOTIFY_CLIENT_ID: 'test_client' },
      fetchFn: mockFetch,
    })

    assert.equal(token, 'brand_new_access_token')
  })

  it('rejects and disconnects when refresh token exceeds 6 months (180 days)', async () => {
    const sixMonthsAndOneDayMs = 181 * 24 * 60 * 60 * 1000
    _setSpotifySessionForTesting({
      accessToken: 'old_access_token',
      refreshToken: 'old_refresh_token',
      expiresAt: Date.now() - 1000,
      issuedAt: Date.now() - sixMonthsAndOneDayMs, // older than 6 months
      scope: 'user-read-private',
    })

    await assert.rejects(
      async () => {
        await getValidSpotifyAccessToken({
          envOverride: { VITE_SPOTIFY_CLIENT_ID: 'test_client' },
        })
      },
      (err: unknown) => {
        assert.ok(err instanceof SpotifyAuthError)
        assert.equal(err.code, 'REFRESH_TOKEN_EXPIRED')
        assert.match(err.message, /6 months/i)
        return true
      },
    )

    assert.equal(getSpotifySession(), null, 'Session should be disconnected after 6 months')
  })

  it('disconnectSpotify clears stored session', () => {
    _setSpotifySessionForTesting({
      accessToken: 'active_token',
      expiresAt: Date.now() + 10000,
      issuedAt: Date.now(),
      scope: 'user-read-private',
    })
    disconnectSpotify()
    assert.equal(getSpotifySession(), null)
  })
})

// ---------------------------------------------------------------------------
// 5. Spotify Search API & Development Mode Limit (Max 10)
// ---------------------------------------------------------------------------

describe('5. Spotify Search & Development Mode Limit (Max 10)', () => {
  beforeEach(() => {
    _resetSpotifyAuthMemoryStoreForTesting()
  })

  it('enforces maximum limit of 10 items in Development Mode', async () => {
    let requestedLimit = 0

    const mockFetch: typeof fetch = async (input) => {
      const url = new URL(input.toString())
      requestedLimit = Number(url.searchParams.get('limit'))

      return new Response(
        JSON.stringify({
          tracks: {
            items: [],
            total: 0,
            limit: requestedLimit,
            offset: 0,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Active session
    _setSpotifySessionForTesting({
      accessToken: 'test_token',
      expiresAt: Date.now() + 3600000,
      issuedAt: Date.now(),
      scope: 'user-read-private',
    })

    const provider = new SpotifyMusicProvider({ fetchFn: mockFetch })

    // Caller requests 50 items
    await provider.searchTracks('Radiohead', { limit: 50 })
    assert.equal(
      requestedLimit,
      SPOTIFY_MAX_SEARCH_LIMIT,
      'Search limit must be clamped to 10 for Spotify Dev Mode',
    )
  })

  it('returns empty array when query is empty without fetching', async () => {
    let fetchCalled = false
    const mockFetch: typeof fetch = async () => {
      fetchCalled = true
      return new Response('{}', { status: 200 })
    }

    const provider = new SpotifyMusicProvider({ fetchFn: mockFetch })
    const results = await provider.searchTracks('   ')
    assert.equal(results.length, 0)
    assert.equal(fetchCalled, false)
  })

  it('handles HTTP 429 Rate Limit with Retry-After header', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response('Rate limited', {
        status: 429,
        headers: { 'Retry-After': '12' },
      })
    }

    _setSpotifySessionForTesting({
      accessToken: 'token',
      expiresAt: Date.now() + 3600000,
      issuedAt: Date.now(),
      scope: 'user-read-private',
    })

    const provider = new SpotifyMusicProvider({ fetchFn: mockFetch })
    await assert.rejects(
      async () => {
        await provider.searchTracks('Coldplay')
      },
      (err: unknown) => {
        assert.match((err as Error).message, /rate limit/i)
        assert.match((err as Error).message, /12 seconds/i)
        return true
      },
    )
  })

  it('handles HTTP 403 Forbidden with 5-user Development Mode explanation', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response('Forbidden', { status: 403 })
    }

    _setSpotifySessionForTesting({
      accessToken: 'token',
      expiresAt: Date.now() + 3600000,
      issuedAt: Date.now(),
      scope: 'user-read-private',
    })

    const provider = new SpotifyMusicProvider({ fetchFn: mockFetch })
    await assert.rejects(
      async () => {
        await provider.searchTracks('Coldplay')
      },
      (err: unknown) => {
        assert.match((err as Error).message, /5 allowlisted users/i)
        return true
      },
    )
  })
})

// ---------------------------------------------------------------------------
// 6. Track Mapping & Playback Honesty
// ---------------------------------------------------------------------------

describe('6. Track Mapping & Playback Honesty (No Fabricated Streams)', () => {
  // Regression for the live "Network error while connecting to Spotify Web API."
  // failure: native browser fetch is a WindowOrWorkerGlobalScope member whose
  // WebIDL binding throws `TypeError: Illegal invocation` when invoked as a
  // method on an unrelated object. The provider must keep the default fetch
  // bound to the global object, or its un-injected search path breaks in the
  // browser only (Node tests with injected plain-function mocks never saw it).
  it('invokes the default platform fetch with a global receiver (no "Illegal invocation")', async () => {
    _resetSpotifyAuthMemoryStoreForTesting()
    _setSpotifySessionForTesting({
      accessToken: 'access_token_receiver_regression',
      expiresAt: Date.now() + 3600 * 1000,
      issuedAt: Date.now(),
      scope: 'user-read-private',
    })

    const originalFetch = globalThis.fetch
    let platformFetchCalled = false
    const nativeLikeFetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      // Mirror the exact browser behavior: invoking native fetch with the
      // provider instance as receiver throws before any network activity.
      if (this instanceof SpotifyMusicProvider) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation")
      }
      platformFetchCalled = true
      const url = String(args[0])
      if (url.includes('/v1/search')) {
        return new Response(
          JSON.stringify({
            tracks: {
              href: url,
              items: [],
              limit: 10,
              next: null,
              offset: 0,
              previous: null,
              total: 0,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('Not found', { status: 404 })
    } as unknown as typeof fetch

    globalThis.fetch = nativeLikeFetch
    try {
      // No injected fetchFn: the default platform fetch path must work in browser
      // conditions (WebIDL receiver check), not only inside Node unit tests.
      const provider = new SpotifyMusicProvider()
      const results = await provider.searchTracks('receiver binding regression')
      assert.equal(
        platformFetchCalled,
        true,
        'Default platform fetch must be invoked instead of failing on an illegal receiver',
      )
      assert.equal(results.length, 0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('correctly maps Spotify API items to MusicTrack and marks isPlayable=false when preview_url is null', () => {
    const provider = new SpotifyMusicProvider()

    const rawSpotifyItem: SpotifyTrackItem = {
      id: '4cOdK2wGLETKBW3PvgPWqT',
      name: 'Never Gonna Give You Up',
      duration_ms: 213573,
      preview_url: null, // Deprecated / null in current Spotify Web API
      external_urls: {
        spotify: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
      },
      uri: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT',
      artists: [
        { id: '0gxyHStUsqpMadRV0Di1Qt', name: 'Rick Astley' },
      ],
      album: {
        id: '2lNXQf9l8a9g0eK1L6V3Y8',
        name: 'Whenever You Need Somebody',
        images: [
          { url: 'https://i.scdn.co/image/ab67616d0000b273', height: 640, width: 640 },
        ],
      },
    }

    const mapped = provider.mapTrack(rawSpotifyItem)

    assert.equal(mapped.provider, 'spotify')
    assert.equal(mapped.providerTrackId, '4cOdK2wGLETKBW3PvgPWqT')
    assert.equal(mapped.title, 'Never Gonna Give You Up')
    assert.equal(mapped.artistName, 'Rick Astley')
    assert.equal(mapped.albumName, 'Whenever You Need Somebody')
    assert.equal(mapped.durationSeconds, 214) // 213573 / 1000 rounded
    assert.equal(mapped.artworkUrl, 'https://i.scdn.co/image/ab67616d0000b273')
    assert.equal(mapped.attributionText, 'Spotify')
    assert.equal(mapped.externalUrl, 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')

    // Crucial playback honesty check:
    assert.equal(mapped.isPlayable, false, 'Track must be marked unplayable when preview_url is null')
    assert.equal(mapped.playbackUrl, undefined, 'No fake playbackUrl should ever be fabricated')
  })
})

// ---------------------------------------------------------------------------
// 7. Supabase Playlist Persistence & Duplicate Prevention
// ---------------------------------------------------------------------------

describe('7. Supabase Playlist Persistence & Collaboration for Spotify Tracks', () => {
  it('correctly tracks Spotify items with duplicate prevention adhering to schema constraint', () => {
    const existingTracks = [
      { provider: 'orbim', providerTrackId: 'track_1' },
      { provider: 'spotify', providerTrackId: 'spotify_track_42' },
    ]

    // Same provider and trackId is detected as duplicate
    const isDup = isDuplicateTrackInList(existingTracks, {
      provider: 'spotify',
      providerTrackId: 'spotify_track_42',
    })
    assert.equal(isDup, true)

    // Different provider or trackId is not duplicate
    const isNotDup = isDuplicateTrackInList(existingTracks, {
      provider: 'spotify',
      providerTrackId: 'spotify_track_99',
    })
    assert.equal(isNotDup, false)

    const isDifferentProvider = isDuplicateTrackInList(existingTracks, {
      provider: 'orbim',
      providerTrackId: 'spotify_track_42',
    })
    assert.equal(isDifferentProvider, false)
  })
})

// ---------------------------------------------------------------------------
// 8. Honest API Failure Handling & Item Filtering
// ---------------------------------------------------------------------------

describe('8. Spotify API Failure Handling & Item Filtering', () => {
  const activeSession = {
    accessToken: 'test_token',
    expiresAt: Date.now() + 3600000,
    issuedAt: Date.now(),
    scope: 'user-read-private',
  }

  beforeEach(() => {
    _resetSpotifyAuthMemoryStoreForTesting()
    _setSpotifySessionForTesting(activeSession)
  })

  it('clears the stored session on HTTP 401 so the UI returns to the connect prompt', async () => {
    const mockFetch: typeof fetch = async () => new Response('Unauthorized', { status: 401 })
    const provider = new SpotifyMusicProvider({ fetchFn: mockFetch })

    await assert.rejects(
      async () => {
        await provider.searchTracks('Coldplay')
      },
      (err: unknown) => {
        assert.match((err as Error).message, /reconnect/i)
        return true
      },
    )

    assert.equal(isSpotifyConnected(), false, 'A rejected token must not stay marked connected')
    assert.equal(getSpotifySession(), null)
  })

  it('reports HTTP 400 as an invalid request instead of an empty catalog', async () => {
    const mockFetch: typeof fetch = async () => new Response('Bad Request', { status: 400 })
    const provider = new SpotifyMusicProvider({ fetchFn: mockFetch })

    await assert.rejects(
      async () => {
        await provider.searchTracks('a'.repeat(500))
      },
      (err: unknown) => {
        assert.match((err as Error).message, /HTTP 400/)
        return true
      },
    )
  })

  it('drops Spotify items without an id, which cannot be saved to a playlist', async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          tracks: {
            items: [
              { id: null, name: 'Local File', artists: [], album: { images: [] }, duration_ms: 0 },
              {
                id: 'valid-track-id',
                name: 'Playable Metadata',
                artists: [{ id: 'a1', name: 'Artist' }],
                album: { id: 'al1', name: 'Album', images: [] },
                duration_ms: 120000,
                preview_url: null,
                external_urls: { spotify: 'https://open.spotify.com/track/valid-track-id' },
              },
            ],
            total: 2,
            limit: 10,
            offset: 0,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )

    const provider = new SpotifyMusicProvider({ fetchFn: mockFetch })
    const results = await provider.searchTracks('local')

    assert.equal(results.length, 1)
    assert.equal(results[0].providerTrackId, 'valid-track-id')
  })

  it('maps the explicit flag from Spotify', () => {
    const provider = new SpotifyMusicProvider()
    const mapped = provider.mapTrack({
      id: 'explicit-track',
      name: 'Explicit Song',
      artists: [{ id: 'a1', name: 'Artist' }],
      album: { id: 'al1', name: 'Album', images: [] },
      duration_ms: 1000,
      explicit: true,
      preview_url: null,
      external_urls: { spotify: 'https://open.spotify.com/track/explicit-track' },
      uri: 'spotify:track:explicit-track',
    })

    assert.equal(mapped.isExplicit, true)
    assert.equal(mapped.albumName, 'Album')
  })
})

// ---------------------------------------------------------------------------
// 9. Spotify Web Playback SDK Authorization Flow & Scope Integrity (Regression Suite)
// ---------------------------------------------------------------------------

describe('9. Spotify Web Playback SDK Authorization Flow & Scope Integrity (Regression Suite)', () => {
  beforeEach(() => {
    _resetSpotifyAuthMemoryStoreForTesting()
  })

  it('initiateSpotifyLogin requests streaming and user-modify-playback-state with show_dialog=true by default', async () => {
    const url = await initiateSpotifyLogin({
      envOverride: { VITE_SPOTIFY_CLIENT_ID: 'playback_client_test' },
      redirectUri: SPOTIFY_LOCAL_DEV_REDIRECT_URI,
    })

    const parsed = new URL(url)
    assert.equal(parsed.searchParams.get('show_dialog'), 'true', 'show_dialog must default to true to prevent silent consent bypass')

    const scopes = parsed.searchParams.get('scope')?.split(' ') ?? []
    assert.ok(scopes.includes('streaming'), 'must request streaming scope')
    assert.ok(scopes.includes('user-modify-playback-state'), 'must request user-modify-playback-state scope')
    assert.ok(scopes.includes('user-read-private'), 'must request user-read-private scope')
    assert.ok(scopes.includes('user-read-email'), 'must request user-read-email scope')
  })

  it('initiateSpotifyLogin respects explicit showDialog: false', async () => {
    const url = await initiateSpotifyLogin({
      envOverride: { VITE_SPOTIFY_CLIENT_ID: 'playback_client_test' },
      redirectUri: SPOTIFY_LOCAL_DEV_REDIRECT_URI,
      showDialog: false,
    })

    const parsed = new URL(url)
    assert.equal(parsed.searchParams.get('show_dialog'), 'false')
  })

  it('spotifyScopesIncludePlaybackScopes strictly requires both streaming and user-modify-playback-state', () => {
    assert.equal(
      spotifyScopesIncludePlaybackScopes('user-read-private user-read-email streaming user-modify-playback-state'),
      true,
    )
    assert.equal(
      spotifyScopesIncludePlaybackScopes('streaming user-modify-playback-state'),
      true,
    )
    assert.equal(
      spotifyScopesIncludePlaybackScopes('user-read-private user-read-email'),
      false,
      'fails without playback scopes',
    )
    assert.equal(
      spotifyScopesIncludePlaybackScopes('user-read-private streaming'),
      false,
      'fails when user-modify-playback-state is missing',
    )
    assert.equal(
      spotifyScopesIncludePlaybackScopes('user-read-private user-modify-playback-state'),
      false,
      'fails when streaming is missing',
    )
    assert.equal(spotifyScopesIncludePlaybackScopes(''), false)
    assert.equal(spotifyScopesIncludePlaybackScopes(null), false)
    assert.equal(spotifyScopesIncludePlaybackScopes(undefined), false)
  })

  it('spotifyMissingPlaybackScopes identifies exact absent playback scopes', () => {
    assert.deepEqual(
      spotifyMissingPlaybackScopes('user-read-private user-read-email streaming user-modify-playback-state'),
      [],
    )
    assert.deepEqual(
      spotifyMissingPlaybackScopes('user-read-private user-read-email streaming'),
      ['user-modify-playback-state'],
    )
    assert.deepEqual(
      spotifyMissingPlaybackScopes('user-read-private user-read-email user-modify-playback-state'),
      ['streaming'],
    )
    assert.deepEqual(
      spotifyMissingPlaybackScopes('user-read-private user-read-email'),
      ['streaming', 'user-modify-playback-state'],
    )
    assert.deepEqual(
      spotifyMissingPlaybackScopes(undefined),
      ['streaming', 'user-modify-playback-state'],
    )
  })

  it('isSpotifyPlaybackAuthorized reflects stored session scope validity', () => {
    assert.equal(isSpotifyPlaybackAuthorized(), false, 'unauthorized when disconnected')

    _setSpotifySessionForTesting({
      accessToken: 'token_no_playback',
      expiresAt: Date.now() + 3600000,
      issuedAt: Date.now(),
      scope: 'user-read-private user-read-email',
    })
    assert.equal(isSpotifyPlaybackAuthorized(), false, 'unauthorized with only profile scopes')

    _setSpotifySessionForTesting({
      accessToken: 'token_with_playback',
      expiresAt: Date.now() + 3600000,
      issuedAt: Date.now(),
      scope: 'user-read-private user-read-email streaming user-modify-playback-state',
    })
    assert.equal(isSpotifyPlaybackAuthorized(), true, 'authorized with streaming + user-modify-playback-state')

    disconnectSpotify()
    assert.equal(isSpotifyPlaybackAuthorized(), false, 'unauthorized after disconnect')
  })

  it('handleSpotifyCallback preserves restricted scopes and refuses to falsely authorize playback', async () => {
    const authUrl = await initiateSpotifyLogin({
      envOverride: { VITE_SPOTIFY_CLIENT_ID: 'test_client' },
      redirectUri: SPOTIFY_LOCAL_DEV_REDIRECT_URI,
    })
    const generatedState = new URL(authUrl).searchParams.get('state')!

    // Mock Spotify returning only profile scopes (e.g. user denied streaming or old token)
    const mockFetch: typeof fetch = async (input) => {
      const urlStr = input.toString()
      if (urlStr.includes('/api/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'mock_access_token_profile_only',
            token_type: 'Bearer',
            scope: 'user-read-private user-read-email',
            expires_in: 3600,
            refresh_token: 'mock_refresh_token_profile_only',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (urlStr.includes('/v1/me')) {
        return new Response(JSON.stringify({ id: 'user_1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('Not found', { status: 404 })
    }

    const session = await handleSpotifyCallback(
      new URLSearchParams({ code: 'code_profile_only', state: generatedState }),
      { envOverride: { VITE_SPOTIFY_CLIENT_ID: 'test_client' }, fetchFn: mockFetch },
    )

    assert.equal(session.scope, 'user-read-private user-read-email')
    assert.equal(isSpotifyConnected(), true)
    assert.equal(isSpotifyPlaybackAuthorized(), false, 'must not falsely grant playback')
  })

  it('handleSpotifyCallback falls back to requested scopes only when scope is omitted under RFC 6749 §5.1', async () => {
    const authUrl = await initiateSpotifyLogin({
      envOverride: { VITE_SPOTIFY_CLIENT_ID: 'test_client' },
      redirectUri: SPOTIFY_LOCAL_DEV_REDIRECT_URI,
    })
    const generatedState = new URL(authUrl).searchParams.get('state')!

    // Mock Spotify omitting `scope` in response body because it is identical to requested
    const mockFetch: typeof fetch = async (input) => {
      const urlStr = input.toString()
      if (urlStr.includes('/api/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'mock_access_token_full',
            token_type: 'Bearer',
            // scope omitted under RFC 6749 §5.1
            expires_in: 3600,
            refresh_token: 'mock_refresh_token_full',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (urlStr.includes('/v1/me')) {
        return new Response(JSON.stringify({ id: 'user_2' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('Not found', { status: 404 })
    }

    const session = await handleSpotifyCallback(
      new URLSearchParams({ code: 'code_full', state: generatedState }),
      { envOverride: { VITE_SPOTIFY_CLIENT_ID: 'test_client' }, fetchFn: mockFetch },
    )

    assert.ok(session.scope.includes('streaming'))
    assert.ok(session.scope.includes('user-modify-playback-state'))
    assert.equal(isSpotifyPlaybackAuthorized(), true)
  })

  it('dispatches SPOTIFY_SESSION_CHANGE_EVENT on session connect, disconnect, and test updates', async () => {
    const originalWindow = globalThis.window
    const fakeWindow = new EventTarget()
    globalThis.window = fakeWindow as unknown as Window & typeof globalThis

    try {
      const eventsEmitted: string[] = []
      fakeWindow.addEventListener(SPOTIFY_SESSION_CHANGE_EVENT, () => {
        eventsEmitted.push(SPOTIFY_SESSION_CHANGE_EVENT)
      })

      // 1. Setting session directly
      _setSpotifySessionForTesting({
        accessToken: 'token_event_test',
        expiresAt: Date.now() + 3600000,
        issuedAt: Date.now(),
        scope: 'streaming user-modify-playback-state',
      })
      assert.equal(eventsEmitted.length, 1)

      // 2. Disconnecting
      disconnectSpotify()
      assert.equal(eventsEmitted.length, 2)
    } finally {
      globalThis.window = originalWindow
    }
  })

  it('getValidSpotifyAccessToken preserves existing scopes and dispatches event when refreshed.scope is omitted', async () => {
    const originalWindow = globalThis.window
    const fakeWindow = new EventTarget()
    globalThis.window = fakeWindow as unknown as Window & typeof globalThis

    try {
      let eventsEmitted = 0
      fakeWindow.addEventListener(SPOTIFY_SESSION_CHANGE_EVENT, () => {
        eventsEmitted++
      })

      // Active session expiring in 10 seconds (needs refresh)
      _setSpotifySessionForTesting({
        accessToken: 'old_expiring_token',
        refreshToken: 'valid_refresh_token',
        expiresAt: Date.now() + 10_000,
        issuedAt: Date.now() - 3600_000,
        scope: 'user-read-private user-read-email streaming user-modify-playback-state',
      })
      eventsEmitted = 0 // Reset counter

      const mockRefreshFetch: typeof fetch = async () =>
        new Response(
          JSON.stringify({
            access_token: 'new_refreshed_access_token',
            token_type: 'Bearer',
            // scope omitted by refresh endpoint
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )

      const token = await getValidSpotifyAccessToken({
        envOverride: { VITE_SPOTIFY_CLIENT_ID: 'test_client' },
        fetchFn: mockRefreshFetch,
      })

      assert.equal(token, 'new_refreshed_access_token')
      const updatedSession = getSpotifySession()
      assert.equal(updatedSession?.accessToken, 'new_refreshed_access_token')
      assert.ok(updatedSession?.scope.includes('streaming'), 'scope must be preserved after refresh')
      assert.ok(updatedSession?.scope.includes('user-modify-playback-state'), 'scope must be preserved after refresh')
      assert.equal(isSpotifyPlaybackAuthorized(), true, 'playback remains authorized after refresh')
      assert.equal(eventsEmitted, 1, 'must dispatch session change event on refresh')
    } finally {
      globalThis.window = originalWindow
    }
  })
})
