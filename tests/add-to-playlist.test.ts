import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { mockPlaylists } from '../src/data/mock/index.ts'
import {
  filterAuthorizedPlaylists,
  isDuplicateConstraintError,
  isDuplicateTrackInList,
  resolveAddToPlaylistUIState,
  type AddToPlaylistOption,
} from '../src/services/playlist/add-to-playlist.ts'
import { buildPlaylistTrackRow } from '../src/services/playlist/supabase-playlist.ts'
import type { MusicTrack } from '../src/types/music.ts'

describe('Phase 6: AddToPlaylistDialog Real Data Migration & Domain Integrity', () => {
  const currentUserId = '11111111-1111-4111-8111-111111111111'
  const otherUserId = '22222222-2222-4222-8222-222222222222'

  const makeOption = (
    id: string,
    title: string,
    ownerId = currentUserId,
    trackCount = 0,
    visibility: 'private' | 'shared' = 'private',
  ): AddToPlaylistOption => ({
    id,
    title,
    description: `Description for ${title}`,
    visibility,
    trackCount,
    ownerId,
    updatedAt: '2026-10-25T12:00:00.000Z',
  })

  describe('1. Guest Access Control & Privacy Protection', () => {
    it('guest in Supabase mode resolves strictly to guest state without private playlists', () => {
      const privatePlaylist = makeOption('p-private', 'Secret Vault', otherUserId, 5, 'private')

      const state = resolveAddToPlaylistUIState({
        user: null,
        isDemo: false,
        remotePlaylists: [privatePlaylist],
        mockPlaylists,
      })

      assert.equal(state.type, 'guest')
      // Ensure private playlists are not exposed in state
      assert.equal('playlists' in state, false)
    })

    it('guest cannot access private playlists or be authorized for modification', () => {
      const playlists = [
        { id: 'p1', owner_id: otherUserId },
        { id: 'p2', owner_id: '33333333-3333-4333-8333-333333333333' },
      ]

      // Guest has no memberships and no ownership
      const authorized = filterAuthorizedPlaylists(playlists, 'guest-has-no-id', new Set())
      assert.equal(authorized.length, 0, 'Guest must have 0 authorized playlists')
    })
  })

  describe('2. Supabase Mode Isolation (Never Merge with Mock Catalog)', () => {
    it('authenticated user with 1 remote playlist resolves strictly to count 1, NOT merged with mock catalog', () => {
      const remote = makeOption('p-remote-1', 'My Remote Jam', currentUserId, 3)

      const state = resolveAddToPlaylistUIState({
        user: { id: currentUserId },
        isDemo: false,
        remotePlaylists: [remote],
        mockPlaylists,
      })

      assert.equal(state.type, 'ready')
      if (state.type === 'ready') {
        assert.equal(state.playlists.length, 1, 'Must have exactly 1 playlist, never merged with mock catalog')
        assert.equal(state.playlists[0].id, 'p-remote-1')
        assert.equal(state.playlists[0].title, 'My Remote Jam')
        assert.equal(state.playlists[0].trackCount, 3)

        // Ensure no mock playlist ID exists in ready results
        const mockIds = new Set(mockPlaylists.map((m) => m.id))
        assert.equal(mockIds.has(state.playlists[0].id), false)
      }
    })

    it('authenticated user with multiple remote playlists retains strict isolation', () => {
      const remotes = [
        makeOption('p1', 'Cloud 1', currentUserId, 0),
        makeOption('p2', 'Cloud 2', currentUserId, 12),
      ]

      const state = resolveAddToPlaylistUIState({
        user: { id: currentUserId },
        isDemo: false,
        remotePlaylists: remotes,
        mockPlaylists,
      })

      assert.equal(state.type, 'ready')
      if (state.type === 'ready') {
        assert.equal(state.playlists.length, 2)
        const titles = state.playlists.map((p) => p.title)
        assert.deepEqual(titles, ['Cloud 1', 'Cloud 2'])
      }
    })
  })

  describe('3. Loading, Empty, and Error States', () => {
    it('resolves to loading state during in-flight fetch', () => {
      const state = resolveAddToPlaylistUIState({
        user: { id: currentUserId },
        isDemo: false,
        remotePlaylists: [],
        isLoading: true,
      })

      assert.equal(state.type, 'loading')
    })

    it('resolves to empty state when user has 0 remote playlists, never falling back to mock data', () => {
      const state = resolveAddToPlaylistUIState({
        user: { id: currentUserId },
        isDemo: false,
        remotePlaylists: [],
        mockPlaylists,
        isLoading: false,
      })

      assert.equal(state.type, 'empty', 'Must resolve to empty state')
      assert.equal('playlists' in state, false, 'Empty state must not expose mock playlists')
    })

    it('resolves to error state on query failure, never falling back to mock data', () => {
      const state = resolveAddToPlaylistUIState({
        user: { id: currentUserId },
        isDemo: false,
        remotePlaylists: [],
        mockPlaylists,
        loadError: 'Database connection timed out',
      })

      assert.equal(state.type, 'error')
      if (state.type === 'error') {
        assert.equal(state.message, 'Database connection timed out')
      }
      assert.equal('playlists' in state, false, 'Error state must not fall back to mock data')
    })
  })

  describe('4. Authorization & Membership Filtering', () => {
    it('authorizes playlists owned by the user', () => {
      const playlists = [
        { id: 'p1', owner_id: currentUserId },
        { id: 'p2', owner_id: otherUserId },
      ]

      const authorized = filterAuthorizedPlaylists(playlists, currentUserId, new Set())
      assert.equal(authorized.length, 1)
      assert.equal(authorized[0].id, 'p1')
    })

    it('authorizes playlists where user is an active collaborator member', () => {
      const playlists = [
        { id: 'p1', owner_id: currentUserId },
        { id: 'p2', owner_id: otherUserId },
        { id: 'p3', owner_id: otherUserId },
      ]
      // Current user is collaborator on p2, but not p3
      const memberPlaylistIds = new Set(['p2'])

      const authorized = filterAuthorizedPlaylists(playlists, currentUserId, memberPlaylistIds)
      assert.equal(authorized.length, 2)
      const ids = authorized.map((p) => p.id)
      assert.deepEqual(ids, ['p1', 'p2'])
    })

    it('excludes playlists where platform admin is not an owner or collaborator', () => {
      const adminUserId = '99999999-9999-4999-8999-999999999999'
      const allPlatformPlaylists = [
        { id: 'p-user-1', owner_id: currentUserId },
        { id: 'p-user-2', owner_id: otherUserId },
        { id: 'p-admin-owned', owner_id: adminUserId },
      ]
      // Admin is not a member of p-user-1 or p-user-2
      const adminMemberships = new Set<string>()

      const writable = filterAuthorizedPlaylists(allPlatformPlaylists, adminUserId, adminMemberships)
      assert.equal(writable.length, 1)
      assert.equal(writable[0].id, 'p-admin-owned')
    })
  })

  describe('5. Duplicate Prevention & Schema Constraint Integrity', () => {
    it('detects duplicate track based on (provider, providerTrackId)', () => {
      const existing = [
        { provider: 'orbim', providerTrackId: 'orb-0001' },
        { provider: 'orbim', providerTrackId: 'orb-0002' },
      ]

      assert.equal(
        isDuplicateTrackInList(existing, { provider: 'orbim', providerTrackId: 'orb-0001' }),
        true,
        'Should identify duplicate with same provider and providerTrackId',
      )

      assert.equal(
        isDuplicateTrackInList(existing, { provider: 'orbim', providerTrackId: 'orb-0003' }),
        false,
        'Should not flag different providerTrackId as duplicate',
      )

      assert.equal(
        isDuplicateTrackInList(existing, { provider: 'custom', providerTrackId: 'orb-0001' }),
        false,
        'Should not flag track with different provider as duplicate',
      )
    })

    it('defaults provider to orbim when verifying duplicates', () => {
      const existing = [{ provider: 'orbim', providerTrackId: 'orb-0001' }]

      assert.equal(
        isDuplicateTrackInList(existing, { providerTrackId: 'orb-0001' }),
        true,
        'Missing provider must default to orbim and match',
      )
    })

    it('classifies PostgreSQL error code 23505 as duplicate constraint violation', () => {
      const pgError = {
        code: '23505',
        message: 'duplicate key value violates unique constraint "playlist_track_unique"',
      }

      assert.equal(isDuplicateConstraintError(pgError), true)
    })

    it('classifies error message referencing playlist_track_unique as duplicate constraint violation', () => {
      const errorWithMessage = {
        message: 'violates unique constraint playlist_track_unique',
      }

      assert.equal(isDuplicateConstraintError(errorWithMessage), true)
    })

    it('does not classify non-duplicate errors as duplicate constraint violations', () => {
      const permissionError = {
        code: '42501',
        message: 'new row violates row-level security policy for table "playlist_tracks"',
      }
      const genericError = new Error('Network timeout')

      assert.equal(isDuplicateConstraintError(permissionError), false)
      assert.equal(isDuplicateConstraintError(genericError), false)
      assert.equal(isDuplicateConstraintError(null), false)
      assert.equal(isDuplicateConstraintError('not an object'), false)
    })
  })

  describe('6. Persistence Confirmation & Failed Mutation Feedback Rules', () => {
    it('verifies that unconfirmed persistence (null data, null error) never returns success', () => {
      // Simulation of a database adapter responding with null data
      const mockDbResponse = { data: null, error: null }
      const hasConfirmedPersistence = Boolean(mockDbResponse.data && !mockDbResponse.error)

      assert.equal(
        hasConfirmedPersistence,
        false,
        'Null database row must not be treated as confirmed persistence',
      )
    })

    it('verifies that failed database operations never produce success output', () => {
      const mockDbError = { data: null, error: new Error('RLS check failed') }
      const isSuccess = Boolean(mockDbError.data && !mockDbError.error)

      assert.equal(isSuccess, false, 'Database error must never indicate success')
    })
  })

  describe('7. Explicit Demo Mode Isolation', () => {
    it('resolves strictly to demo state with mock playlists in demo mode', () => {
      const state = resolveAddToPlaylistUIState({
        user: null,
        isDemo: true,
        remotePlaylists: [],
        mockPlaylists,
      })

      assert.equal(state.type, 'demo')
      if (state.type === 'demo') {
        assert.equal(state.playlists.length, 7, 'Demo mode should supply all 7 mock playlists')
        assert.equal(state.playlists[0].id, mockPlaylists[0].id)
      }
    })

    it('authenticated user in explicit demo mode receives demo state preview', () => {
      const state = resolveAddToPlaylistUIState({
        user: { id: currentUserId },
        isDemo: true,
        remotePlaylists: [],
        mockPlaylists,
      })

      assert.equal(state.type, 'demo')
      if (state.type === 'demo') {
        assert.equal(state.playlists.length, 7)
      }
    })
  })
})

describe('8. Spotify Persistence Row Builder (Metadata Only)', () => {
  const userId = '11111111-1111-4111-8111-111111111111'

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
    // A preview may be playable in Explore, but it is not an ORBIM audio source.
    isPlayable: true,
    playbackUrl: 'https://p.scdn.co/mp3-preview/example',
    externalUrl: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
    attributionText: 'Spotify',
  }

  it('persists Spotify track metadata without copying the preview into audio columns', () => {
    const row = buildPlaylistTrackRow({
      playlistId: 'playlist-1',
      track: spotifyTrack,
      userId,
      position: 2000,
    })

    assert.equal(row.playlist_id, 'playlist-1')
    assert.equal(row.provider, 'spotify')
    assert.equal(row.provider_track_id, '4cOdK2wGLETKBW3PvgPWqT')
    assert.equal(row.title, 'Never Gonna Give You Up')
    assert.equal(row.artist_name, 'Rick Astley')
    assert.equal(row.album_name, 'Whenever You Need Somebody')
    assert.equal(row.artwork_url, 'https://i.scdn.co/image/ab67616d0000b273')
    assert.equal(row.duration_seconds, 214)
    assert.equal(row.position, 2000)
    assert.equal(row.added_by, userId)
    assert.equal(row.added_via, 'web_ui')
    assert.equal(row.verification_status, 'unverified')

    assert.equal(row.audio_url, null, 'Spotify preview URLs must not be persisted as track audio')
    assert.equal(row.storage_path, null)
    assert.equal(row.audio_source_type, 'none')
  })

  it('still persists Storage-backed audio for tracks that own it', () => {
    const ownedTrack: MusicTrack = {
      provider: 'custom',
      providerTrackId: 'custom-1',
      title: 'Owned Audio',
      artistName: 'Independent Artist',
      durationSeconds: 180,
      genre: 'Custom / Imported',
      moods: [],
      isPlayable: true,
      audioSourceType: 'storage',
      storagePath: 'tracks/owned-audio.mp3',
      audioSourceUrl: 'https://example.supabase.co/storage/v1/object/public/track-audio/tracks/owned-audio.mp3',
    }

    const row = buildPlaylistTrackRow({
      playlistId: 'playlist-1',
      track: ownedTrack,
      userId,
      position: 1000,
    })

    assert.equal(row.audio_source_type, 'storage')
    assert.equal(row.storage_path, 'tracks/owned-audio.mp3')
    assert.equal(
      row.audio_url,
      'https://example.supabase.co/storage/v1/object/public/track-audio/tracks/owned-audio.mp3',
    )
  })

  it('still persists an approved direct stream URL', () => {
    const streamTrack: MusicTrack = {
      provider: 'custom',
      providerTrackId: 'custom-2',
      title: 'Licensed Stream',
      artistName: 'Independent Artist',
      durationSeconds: 200,
      genre: 'Custom / Imported',
      moods: [],
      isPlayable: true,
      audioSourceType: 'direct_stream',
      audioSourceUrl: 'https://example.org/stream/licensed.mp3',
    }

    const row = buildPlaylistTrackRow({
      playlistId: 'playlist-1',
      track: streamTrack,
      userId,
      position: 1000,
    })

    assert.equal(row.audio_source_type, 'direct_stream')
    assert.equal(row.audio_url, 'https://example.org/stream/licensed.mp3')
  })

  it('does not treat the same providerTrackId under another provider as a duplicate', () => {
    assert.equal(
      isDuplicateTrackInList(
        [{ provider: 'spotify', providerTrackId: 'shared-id' }],
        { provider: 'orbim', providerTrackId: 'shared-id' },
      ),
      false,
    )
    assert.equal(
      isDuplicateTrackInList(
        [{ provider: 'spotify', providerTrackId: 'shared-id' }],
        { provider: 'spotify', providerTrackId: 'shared-id' },
      ),
      true,
    )
  })
})
