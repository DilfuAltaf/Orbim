import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  assertNotVybeSecretKey,
  buildVybeUsagePayload,
  classifyVybeCredential,
  isValidVybePublishableKey,
  isValidVybeSessionToken,
  isVybeStreamUrlExpired,
  MOCK_VYBE_CATALOG,
  MOCK_VYBE_TRACK_1,
  MOCK_VYBE_TRACK_2,
  MOCK_VYBE_TRACK_3,
  VYBE_ATTRIBUTION_TEXT,
  VYBE_STREAM_URL_LIFETIME_MS,
  VybeMusicProvider,
} from '../src/services/vybe/index.ts'
import { getMusicProvider } from '../src/services/music/index.ts'
import { isDuplicateTrackInList } from '../src/services/playlist/add-to-playlist.ts'
import { mapPlaylistTrackRow } from '../src/services/playlist/track-mapping.ts'
import { buildPlaylistTrackRow } from '../src/services/playlist/supabase-playlist.ts'
import type { SupabaseTrackRow } from '../src/services/playlist/supabase-playlist.ts'

describe('VYBE Music Provider — Phase 2 Architecture & Mock Integration', () => {
  // -------------------------------------------------------------------------
  // 1. Normalized Track Metadata Mapping
  // -------------------------------------------------------------------------
  describe('1. Normalized Track Metadata Mapping', () => {
    const provider = new VybeMusicProvider()

    it('maps full VYBE track item with artist object, slug, credits, and lyrics', () => {
      const mapped = provider.mapTrack(MOCK_VYBE_TRACK_1)

      assert.equal(mapped.provider, 'vybe')
      assert.equal(mapped.providerTrackId, '6c1f2a4e-8d3b-4f7a-9b21-0e5d7c9a1f30')
      assert.equal(mapped.title, 'Midnight Horizon')
      assert.equal(mapped.artistName, 'Aetheria')
      assert.equal(mapped.artistUrl, 'https://vybemusic.com/artists/aetheria')
      assert.equal(mapped.albumName, 'Neon Odyssey')
      assert.equal(mapped.durationSeconds, 215) // 214.5 rounded
      assert.equal(mapped.artworkUrl, 'https://cdn.vybemusic.com/art/6c1f2a4e-8d3b-4f7a-9b21-0e5d7c9a1f30.webp')
      assert.equal(mapped.genre, 'Synthwave')
      assert.deepEqual(mapped.moods, ['chill', 'focus', 'night'])
      assert.equal(mapped.isPlayable, true)
      assert.equal(mapped.playbackUrl, 'https://stream.vybemusic.com/v1/s/mock_stream_token_001.mp3')
      assert.equal(mapped.externalUrl, 'https://vybemusic.com/tracks/midnight-horizon')
      assert.equal(mapped.attributionText, 'Music from VYBE')
      assert.equal(mapped.lyricsStatus, 'available')
      assert.ok(mapped.lyrics?.includes('Under the neon canopy'))
    })

    it('maps track with string artist shape and fallback artwork_url', () => {
      const mapped = provider.mapTrack(MOCK_VYBE_TRACK_2)

      assert.equal(mapped.provider, 'vybe')
      assert.equal(mapped.artistName, 'Solstice Collective')
      assert.equal(mapped.artistUrl, undefined)
      assert.equal(mapped.albumName, 'Equinox')
      assert.equal(mapped.durationSeconds, 182)
      assert.equal(mapped.artworkUrl, 'https://cdn.vybemusic.com/art/3e9b1a2c-4d5e-6f7a-8b9c-0d1e2f3a4b5c.jpg')
      assert.equal(mapped.genre, 'Lo-Fi')
      assert.deepEqual(mapped.moods, ['euphoric', 'sunny'])
      assert.equal(mapped.attributionText, 'Music from VYBE')
    })

    it('constructs artist link from artist slug if direct URL is omitted', () => {
      const mapped = provider.mapTrack(MOCK_VYBE_TRACK_3)
      assert.equal(mapped.artistUrl, 'https://vybemusic.com/artists/kroma-sound')
      assert.equal(mapped.externalUrl, 'https://vybemusic.com/tracks/quantum-drift')
      assert.equal(mapped.attributionText, 'Music from VYBE')
    })
  })

  // -------------------------------------------------------------------------
  // 2. Provider Factory & Coexistence
  // -------------------------------------------------------------------------
  describe('2. Provider Factory & Coexistence with Spotify and Database', () => {
    it('getMusicProvider returns VybeMusicProvider when vybe is requested', () => {
      const vybeProvider = getMusicProvider('vybe')
      assert.equal(vybeProvider.id, 'vybe')
      assert.equal(vybeProvider.name, 'VYBE')
    })

    it('getMusicProvider preserves existing Spotify, Demo, and Database providers', () => {
      const spotifyProvider = getMusicProvider('spotify')
      assert.equal(spotifyProvider.id, 'spotify')

      const demoProvider = getMusicProvider('demo')
      assert.equal(demoProvider.id, 'demo')

      const orbimProvider = getMusicProvider('orbim')
      assert.equal(orbimProvider.id, 'orbim')
    })
  })

  // -------------------------------------------------------------------------
  // 3. Offline Catalog Search & Track Retrieval
  // -------------------------------------------------------------------------
  describe('3. Offline Catalog Search & Track Retrieval (Phase 2)', () => {
    const provider = new VybeMusicProvider({ useMockCatalog: true })

    it('returns all mock tracks when query is empty', async () => {
      const results = await provider.searchTracks('')
      assert.equal(results.length, MOCK_VYBE_CATALOG.length)
      assert.ok(results.every((t) => t.provider === 'vybe'))
    })

    it('filters tracks by title or artist query', async () => {
      const byTitle = await provider.searchTracks('Horizon')
      assert.equal(byTitle.length, 1)
      assert.equal(byTitle[0].title, 'Midnight Horizon')

      const byArtist = await provider.searchTracks('Solstice')
      assert.equal(byArtist.length, 1)
      assert.equal(byArtist[0].artistName, 'Solstice Collective')
    })

    it('filters tracks by genre/vybe', async () => {
      const synthwave = await provider.searchTracks('', { genre: 'Synthwave' })
      assert.equal(synthwave.length, 1)
      assert.equal(synthwave[0].title, 'Midnight Horizon')
    })

    it('getTrack returns matching track by ID and null for unknown ID', async () => {
      const track = await provider.getTrack('6c1f2a4e-8d3b-4f7a-9b21-0e5d7c9a1f30')
      assert.ok(track)
      assert.equal(track.title, 'Midnight Horizon')

      const missing = await provider.getTrack('unknown-id-999')
      assert.equal(missing, null)
    })
  })

  // -------------------------------------------------------------------------
  // 4. Credential Classification & Security Guards
  // -------------------------------------------------------------------------
  describe('4. Credential Classification & Security Enforcement', () => {
    it('classifies credentials into publishable_key, secret_key, and session_token', () => {
      assert.equal(
        classifyVybeCredential('vybe_pub_0123456789abcdef0123456789abcdef01234567'),
        'publishable_key',
      )
      assert.equal(
        classifyVybeCredential('vybe_sec_master_key_999'),
        'secret_key',
      )
      assert.equal(
        classifyVybeCredential('vybe_ct_session_token_user_123'),
        'session_token',
      )
      assert.equal(classifyVybeCredential('random_bearer_token'), 'unknown')
      assert.equal(classifyVybeCredential(''), 'unknown')
      assert.equal(classifyVybeCredential(null), 'unknown')
    })

    it('validates publishable key and session token formats', () => {
      assert.equal(
        isValidVybePublishableKey('vybe_pub_0123456789abcdef0123456789abcdef01234567'),
        true,
      )
      assert.equal(isValidVybePublishableKey('vybe_pub_short'), false)
      assert.equal(isValidVybePublishableKey('vybe_sec_test'), false)

      assert.equal(isValidVybeSessionToken('vybe_ct_client_token_abc123'), true)
      assert.equal(isValidVybeSessionToken('invalid_token'), false)
    })

    it('assertNotVybeSecretKey throws on secret key attempting client entry', () => {
      assert.throws(
        () => assertNotVybeSecretKey('vybe_sec_master_secret_here'),
        /Security violation: VYBE secret keys.*never be used in frontend/,
      )
      // Allowed keys do not throw
      assert.doesNotThrow(() =>
        assertNotVybeSecretKey('vybe_pub_0123456789abcdef0123456789abcdef01234567'),
      )
      assert.doesNotThrow(() => assertNotVybeSecretKey('vybe_ct_token'))
      assert.doesNotThrow(() => assertNotVybeSecretKey(undefined))
    })

    it('VybeMusicProvider constructor rejects secret keys', () => {
      assert.throws(
        () => new VybeMusicProvider({ apiKey: 'vybe_sec_leaked_key' }),
        /Security violation/,
      )
    })
  })

  // -------------------------------------------------------------------------
  // 5. Six-Hour Stream URL Lifetime & Expiry Checking
  // -------------------------------------------------------------------------
  describe('5. Stream URL Lifetime & Expiry Checking', () => {
    it('verifies 6-hour lifetime constant (21,600,000 ms)', () => {
      assert.equal(VYBE_STREAM_URL_LIFETIME_MS, 6 * 60 * 60 * 1000)
    })

    it('isVybeStreamUrlExpired reports false for fresh URLs', () => {
      const now = Date.now()
      assert.equal(isVybeStreamUrlExpired(now), false)
      // 1 hour old -> not expired
      assert.equal(isVybeStreamUrlExpired(now - 3600 * 1000), false)
      // 5 hours old -> not expired
      assert.equal(isVybeStreamUrlExpired(now - 5 * 3600 * 1000), false)
    })

    it('isVybeStreamUrlExpired reports true when within buffer or past 6 hours', () => {
      const now = Date.now()
      // 5 hours 56 minutes old (within 5-minute safety buffer) -> expired
      assert.equal(isVybeStreamUrlExpired(now - (6 * 3600 * 1000 - 4 * 60 * 1000)), true)
      // 7 hours old -> expired
      assert.equal(isVybeStreamUrlExpired(now - 7 * 3600 * 1000), true)
    })
  })

  // -------------------------------------------------------------------------
  // 6. Usage Reporting Batch Builder (/v1/usage)
  // -------------------------------------------------------------------------
  describe('6. Usage Reporting Batch Builder (/v1/usage)', () => {
    it('builds valid batch payload for stream, complete, skip, and like events', () => {
      const payload = buildVybeUsagePayload([
        { trackId: 'track_1', event: 'stream' },
        { trackId: 'track_1', event: 'complete' },
        { trackId: 'track_2', event: 'skip' },
        { trackId: 'track_3', event: 'like' },
      ])

      assert.deepEqual(payload, {
        events: [
          { track_id: 'track_1', event: 'stream' },
          { track_id: 'track_1', event: 'complete' },
          { track_id: 'track_2', event: 'skip' },
          { track_id: 'track_3', event: 'like' },
        ],
      })
    })

    it('strictly guarantees no user personal data in payload', () => {
      const payload = buildVybeUsagePayload([{ trackId: 'track_10', event: 'stream' }])
      const json = JSON.stringify(payload)

      // Must not contain user identifiers, emails, names
      assert.ok(!json.includes('user_id'))
      assert.ok(!json.includes('email'))
      assert.ok(!json.includes('display_name'))
    })
  })

  // -------------------------------------------------------------------------
  // 7. Playlist Storage & De-duplication Compatibility
  // -------------------------------------------------------------------------
  describe('7. Playlist Storage & Provider De-duplication', () => {
    it('detects duplicate VYBE tracks in a playlist adhering to (provider, providerTrackId)', () => {
      const existing = [
        { provider: 'spotify', providerTrackId: 'spotify_001' },
        { provider: 'vybe', providerTrackId: 'vybe_001' },
      ]

      // Same provider and track ID is a duplicate
      assert.equal(
        isDuplicateTrackInList(existing, { provider: 'vybe', providerTrackId: 'vybe_001' }),
        true,
      )

      // Different ID is not a duplicate
      assert.equal(
        isDuplicateTrackInList(existing, { provider: 'vybe', providerTrackId: 'vybe_002' }),
        false,
      )

      // Same ID with DIFFERENT provider (e.g. spotify vs vybe) is NOT a duplicate
      assert.equal(
        isDuplicateTrackInList(existing, { provider: 'spotify', providerTrackId: 'vybe_001' }),
        false,
      )
    })

    it('buildPlaylistTrackRow preserves VYBE metadata without persisting temporary audio URLs', () => {
      const provider = new VybeMusicProvider()
      const track = provider.mapTrack(MOCK_VYBE_TRACK_1)

      const row = buildPlaylistTrackRow({
        playlistId: 'playlist_123',
        track,
        userId: 'user_456',
        position: 1000.0,
      })

      assert.equal(row.provider, 'vybe')
      assert.equal(row.provider_track_id, '6c1f2a4e-8d3b-4f7a-9b21-0e5d7c9a1f30')
      assert.equal(row.title, 'Midnight Horizon')
      assert.equal(row.artist_name, 'Aetheria')
      assert.equal(row.duration_seconds, 215)
      // Ephemeral stream URL is NOT saved to the database:
      assert.equal(row.audio_url, null)
      assert.equal(row.storage_path, null)
      assert.equal(row.audio_source_type, 'none')
    })

    it('mapPlaylistTrackRow maps stored VYBE row with Music from VYBE attribution', () => {
      const fakeRow: SupabaseTrackRow = {
        id: 'row_123',
        playlist_id: 'pl_1',
        provider: 'vybe',
        provider_track_id: 'vybe_track_001',
        title: 'Neon Odyssey',
        artist_name: 'Aetheria',
        album_name: 'Odyssey',
        artwork_url: 'https://cdn.vybemusic.com/art.jpg',
        duration_seconds: 215,
        position: 1000,
        added_by: 'user_1',
        added_at: '2026-10-30T00:00:00Z',
        audio_url: null,
        storage_path: null,
        audio_source_type: 'none',
        verification_status: 'unverified',
      }

      const mapped = mapPlaylistTrackRow(fakeRow)
      assert.equal(mapped.provider, 'vybe')
      assert.equal(mapped.attributionText, VYBE_ATTRIBUTION_TEXT)
      assert.equal(mapped.genre, 'VYBE Independent')
      assert.equal(mapped.title, 'Neon Odyssey')
    })
  })
})
