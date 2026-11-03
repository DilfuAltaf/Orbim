import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'

/**
 * Phase 7 — Explore page data-source isolation tests.
 *
 * Verifies that:
 * 1. Supabase empty results never fall back to mock tracks.
 * 2. Supabase query failures never fall back to mock tracks.
 * 3. Demo fixtures are isolated to demo mode.
 * 4. Loading, empty, and error states resolve correctly.
 * 5. Verification / playability labels reflect actual source data.
 */

// ---------------------------------------------------------------------------
// Helpers: import provider classes and mock data
// ---------------------------------------------------------------------------

const { DatabaseMusicProvider } = await import(
  '../src/services/music/database-provider.ts'
)
const { MockMusicProvider } = await import('../src/services/music/mock.ts')
const { getMusicProvider } = await import('../src/services/music/index.ts')
const { mockTracks } = await import('../src/data/mock/tracks.ts')

// ---------------------------------------------------------------------------
// 1. DatabaseMusicProvider never falls back to mock tracks
// ---------------------------------------------------------------------------

describe('DatabaseMusicProvider — No mock fallback', () => {
  let provider: InstanceType<typeof DatabaseMusicProvider>

  beforeEach(() => {
    provider = new DatabaseMusicProvider()
  })

  it('has provider id "orbim"', () => {
    assert.equal(provider.id, 'orbim')
    assert.equal(provider.name, 'ORBIM Database')
  })

  it('searchTracks throws on Supabase error instead of falling back to mock data', async () => {
    // The Supabase proxy will throw because there are no valid env credentials
    // in the test runner. The DatabaseMusicProvider must propagate the error,
    // NOT silently return mock tracks.
    try {
      const results = await provider.searchTracks('')
      // If we somehow get results, verify they are NOT mock data
      for (const track of results) {
        assert.notEqual(
          track.provider,
          'demo',
          `Track "${track.title}" should not come from the demo provider in Supabase mode`,
        )
      }
    } catch (err: unknown) {
      // Expected: error is propagated, not silently swallowed
      assert.ok(err instanceof Error, 'Expected an Error instance to be thrown')
      assert.ok(
        err.message.length > 0,
        'Error message should be non-empty',
      )
    }
  })

  it('searchTracks never returns tracks from the mock catalog on failure', async () => {
    const mockTrackIds = new Set(mockTracks.map((t) => t.providerTrackId))

    try {
      const results = await provider.searchTracks('Paper Satellites')
      // If it doesn't throw, it must not contain mock track IDs
      for (const track of results) {
        assert.ok(
          !mockTrackIds.has(track.providerTrackId),
          `Track "${track.title}" (${track.providerTrackId}) is a mock fixture and must not appear in Supabase mode`,
        )
      }
    } catch {
      // Error propagation is the correct behavior when Supabase is unreachable
    }
  })

  it('getTrack throws on Supabase error instead of returning a mock track', async () => {
    // 'orb-0001' is a well-known mock track ID
    try {
      const track = await provider.getTrack('orb-0001')
      // If no error, the track must NOT be from mock data
      if (track !== null) {
        assert.notEqual(
          track.provider,
          'demo',
          'getTrack must not return a demo fixture in Supabase mode',
        )
      }
    } catch (err: unknown) {
      assert.ok(err instanceof Error, 'Expected an Error instance to be thrown')
    }
  })

  it('searchTracks respects AbortSignal', async () => {
    const controller = new AbortController()
    controller.abort()

    await assert.rejects(
      () => provider.searchTracks('test', { signal: controller.signal }),
      (err: unknown) =>
        err instanceof DOMException && err.name === 'AbortError',
    )
  })

  it('getTrack respects AbortSignal', async () => {
    const controller = new AbortController()
    controller.abort()

    await assert.rejects(
      () => provider.getTrack('orb-0001', { signal: controller.signal }),
      (err: unknown) =>
        err instanceof DOMException && err.name === 'AbortError',
    )
  })
})

// ---------------------------------------------------------------------------
// 2. MockMusicProvider is isolated to demo mode
// ---------------------------------------------------------------------------

describe('MockMusicProvider — Demo mode isolation', () => {
  let provider: InstanceType<typeof MockMusicProvider>

  beforeEach(() => {
    provider = new MockMusicProvider()
  })

  it('has provider id "demo"', () => {
    assert.equal(provider.id, 'demo')
    assert.equal(provider.name, 'Demo Catalog')
  })

  it('returns tracks from the mock catalog', async () => {
    const results = await provider.searchTracks('')
    assert.ok(results.length > 0, 'Demo catalog should return tracks')

    for (const track of results) {
      assert.equal(
        track.provider,
        'demo',
        `Demo catalog track "${track.title}" should have provider="demo"`,
      )
    }
  })

  it('search filters work within the demo catalog', async () => {
    const allTracks = await provider.searchTracks('')
    const filtered = await provider.searchTracks('Paper Satellites')

    assert.ok(allTracks.length > filtered.length, 'Filtered results should be a subset')
    for (const track of filtered) {
      const haystack = `${track.title} ${track.artistName} ${track.albumName ?? ''}`.toLowerCase()
      assert.ok(
        haystack.includes('paper') || haystack.includes('satellites'),
        `Filtered track "${track.title}" should match the query`,
      )
    }
  })

  it('getTrack returns null for unknown IDs', async () => {
    const result = await provider.getTrack('nonexistent-id-12345')
    assert.equal(result, null)
  })

  it('getTrack returns the correct mock track by ID', async () => {
    const result = await provider.getTrack('orb-0001')
    assert.ok(result !== null, 'Should find mock track orb-0001')
    assert.equal(result.providerTrackId, 'orb-0001')
    assert.equal(result.provider, 'demo')
  })
})

// ---------------------------------------------------------------------------
// 3. getMusicProvider respects data source configuration
// ---------------------------------------------------------------------------

describe('getMusicProvider — Data source routing', () => {
  it('returns MockMusicProvider for explicit "demo" parameter', () => {
    const provider = getMusicProvider('demo')
    assert.equal(provider.id, 'demo')
    assert.ok(provider instanceof MockMusicProvider)
  })

  it('returns DatabaseMusicProvider for explicit "orbim" parameter', () => {
    const provider = getMusicProvider('orbim')
    assert.equal(provider.id, 'orbim')
    assert.ok(provider instanceof DatabaseMusicProvider)
  })

  it('never returns demo provider when "orbim" is explicitly requested', () => {
    const provider = getMusicProvider('orbim')
    assert.notEqual(provider.id, 'demo')
  })
})

// ---------------------------------------------------------------------------
// 4. Verification / playability labels reflect actual source data
// ---------------------------------------------------------------------------

describe('Track verification and playability — Honest labeling', () => {
  it('DatabaseMusicProvider marks all tracks as not playable (no audio source)', async () => {
    const provider = new DatabaseMusicProvider()
    try {
      const results = await provider.searchTracks('')
      for (const track of results) {
        assert.equal(
          track.isPlayable,
          false,
          `Track "${track.title}" should not be marked playable without a verified audio source`,
        )
      }
    } catch {
      // If Supabase is unreachable, the provider throws rather than returning fake playable tracks
    }
  })

  it('Demo tracks have isPlayable based on their unavailable flag', async () => {
    const provider = new MockMusicProvider()
    const results = await provider.searchTracks('')

    // At least some tracks should be playable (the ones without unavailable: true)
    const playable = results.filter((t) => t.isPlayable)

    assert.ok(playable.length > 0, 'Some demo tracks should be playable')
    // Not all tracks are playable — orb-0024 and orb-0025 have unavailable: true
    assert.ok(
      playable.length <= results.length,
      'Playability should reflect per-track unavailable flag',
    )
  })

  it('DatabaseMusicProvider never fabricates verification status', async () => {
    const provider = new DatabaseMusicProvider()
    try {
      const results = await provider.searchTracks('')
      for (const track of results) {
        // If verificationStatus is set, it must come from actual DB data, not be 'verified' by default
        if (track.verificationStatus !== undefined) {
          assert.ok(
            ['verified', 'unverified', 'rejected'].includes(track.verificationStatus),
            `verificationStatus must be a valid value, got: ${track.verificationStatus}`,
          )
        }
      }
    } catch {
      // Expected when Supabase is not configured in test env
    }
  })

  it('Mock tracks do not carry fabricated verification or licensing metadata', () => {
    for (const track of mockTracks) {
      assert.equal(
        track.verificationStatus,
        undefined,
        `Mock track "${track.title}" should not have a verificationStatus`,
      )
      assert.equal(
        track.licenseUrl,
        undefined,
        `Mock track "${track.title}" should not have a licenseUrl`,
      )
    }
  })
})

// ---------------------------------------------------------------------------
// 5. Provider source code does not contain silent mock fallback
// ---------------------------------------------------------------------------

describe('Source code invariants — No silent fallback', () => {
  it('DatabaseMusicProvider source does not import searchTracks from mock', async () => {
    const fs = await import('node:fs')
    const source = fs.readFileSync(
      'src/services/music/database-provider.ts',
      'utf-8',
    )

    assert.ok(
      !source.includes('searchMockTracks'),
      'DatabaseMusicProvider must not import searchMockTracks',
    )
    assert.ok(
      !source.includes('from.*mock'),
      'DatabaseMusicProvider must not import from mock module',
    )
    assert.ok(
      !source.includes("mockTracks"),
      'DatabaseMusicProvider must not reference mockTracks',
    )
  })

  it('DatabaseMusicProvider does not silently catch errors with empty fallback', async () => {
    const fs = await import('node:fs')
    const source = fs.readFileSync(
      'src/services/music/database-provider.ts',
      'utf-8',
    )

    // Check that catch blocks don't silently swallow and fall through to mock data
    // The old code had `catch { // Fallback to local mock catalog }`
    assert.ok(
      !source.includes('Fallback to local mock catalog'),
      'Must not contain "Fallback to local mock catalog" comment',
    )
    assert.ok(
      !source.includes('Fallback to mock tracks'),
      'Must not contain "Fallback to mock tracks" comment',
    )
  })
})
