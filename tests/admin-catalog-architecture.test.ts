import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

import { isUserAdmin } from '../src/features/auth/admin.ts'
import {
  createDraftCatalogTrack,
  fetchAdminCatalogTracks,
  fetchPublishedCatalogTracks,
  getCatalogTrack,
  mapCatalogRecordToMusicTrack,
  unpublishCatalogTrack,
  uploadAndPublishCatalogTrack,
} from '../src/services/catalog/global-catalog-service.ts'
import { addTrackToUserPlaylist } from '../src/services/playlist/add-to-playlist.ts'
import { buildPlaylistTrackRow } from '../src/services/playlist/supabase-playlist.ts'
import type { MusicTrack } from '../src/types/music.ts'

const ADMIN_EMAIL = 'dilfualtaf07@gmail.com'
const REGULAR_USER_EMAIL = 'user@example.com'

describe('ORBIM — Admin-Managed Global Music Catalog Architecture & Security', () => {
  const sampleTrack: MusicTrack = {
    id: 'test-track-001',
    provider: 'spotify',
    providerTrackId: 'spotify_sample_001',
    title: 'Starboy (Admin Catalog)',
    artistName: 'The Weeknd, Daft Punk',
    albumName: 'Starboy',
    durationSeconds: 230,
    genre: 'R&B',
    moods: [],
    isPlayable: false,
    audioSourceType: 'none',
  }

  const dummyAudioFile = new Blob([new Uint8Array(2048)], { type: 'audio/mpeg' })

  // --------------------------------------------------------------------------
  // Rule 1: Authorization Controls (Admin vs Regular)
  // --------------------------------------------------------------------------
  it('enforces that only dilfualtaf07@gmail.com is recognized as platform admin', () => {
    assert.equal(isUserAdmin(ADMIN_EMAIL), true, 'dilfualtaf07@gmail.com must be admin')
    assert.equal(isUserAdmin('DILFUALTAF07@GMAIL.COM'), true, 'admin email check must be case-insensitive')
    assert.equal(isUserAdmin(REGULAR_USER_EMAIL), false, 'regular user must not be admin')
    assert.equal(isUserAdmin(null), false, 'anonymous user must not be admin')
    assert.equal(isUserAdmin(undefined), false, 'undefined email must not be admin')
  })

  // --------------------------------------------------------------------------
  // Rule 2 & 5: Regular user cannot upload audio or create drafts
  // --------------------------------------------------------------------------
  it('prevents regular users from uploading audio or creating draft tracks', async () => {
    await assert.rejects(
      async () => {
        await createDraftCatalogTrack({
          userEmail: REGULAR_USER_EMAIL,
          userId: 'regular-user-id',
          track: sampleTrack,
        })
      },
      /Hanya akun administrator.*yang diizinkan/i,
      'Regular user draft creation must be rejected',
    )

    const uploadRes = await uploadAndPublishCatalogTrack({
      userEmail: REGULAR_USER_EMAIL,
      userId: 'regular-user-id',
      track: sampleTrack,
      audioFile: dummyAudioFile,
      fileName: 'test.mp3',
    })

    assert.equal(uploadRes.success, false)
    assert.ok(uploadRes.error)
    assert.match(uploadRes.error.message, /Hanya akun administrator/i)
  })

  // --------------------------------------------------------------------------
  // Verification Scenario 1: Admin creates draft -> regular user cannot see it
  // --------------------------------------------------------------------------
  it('Scenario 1: Admin creates a draft track -> regular user cannot see or query it', async () => {
    const draftTrackMetadata: MusicTrack = {
      ...sampleTrack,
      providerTrackId: 'spotify_draft_only_123',
      title: 'Secret Draft Song',
    }

    const draft = await createDraftCatalogTrack({
      userEmail: ADMIN_EMAIL,
      userId: 'admin-id-123',
      track: draftTrackMetadata,
    })

    assert.equal(draft.publicationStatus, 'draft')
    assert.equal(draft.audioUrl, null)

    // Admin CAN see it in admin catalog view
    const adminCatalog = await fetchAdminCatalogTracks({
      userEmail: ADMIN_EMAIL,
      status: 'all',
    })
    const foundInAdmin = adminCatalog.find((r) => r.providerTrackId === 'spotify_draft_only_123')
    assert.ok(foundInAdmin, 'Admin must see draft in admin catalog')

    // Regular user CANNOT see it in public catalog
    const publicCatalog = await fetchPublishedCatalogTracks({
      searchQuery: 'Secret Draft Song',
    })
    const foundInPublic = publicCatalog.find((t) => t.providerTrackId === 'spotify_draft_only_123')
    assert.equal(foundInPublic, undefined, 'Regular user must not see draft in public catalog search')

    // Regular user direct access via getCatalogTrack returns null
    const directAccess = getCatalogTrack(draft.id, REGULAR_USER_EMAIL)
    assert.equal(directAccess, null, 'Direct access to draft by regular user must be denied (returns null)')
  })

  // --------------------------------------------------------------------------
  // Verification Scenario 2: Admin uploads audio without publishing (draft)
  // --------------------------------------------------------------------------
  it('Scenario 2: Admin creates draft track -> regular user cannot see or play it', async () => {
    const unpublishedTrackMetadata: MusicTrack = {
      ...sampleTrack,
      providerTrackId: 'spotify_unpub_with_audio_456',
      title: 'Unpublished Audio Track',
    }

    const draft = await createDraftCatalogTrack({
      userEmail: ADMIN_EMAIL,
      userId: 'admin-id-123',
      track: unpublishedTrackMetadata,
    })

    // Regular user direct lookup
    const userView = getCatalogTrack(draft.id, REGULAR_USER_EMAIL)
    assert.equal(userView, null, 'Regular user cannot access unpublished track')

    // Public catalog query
    const catalog = await fetchPublishedCatalogTracks({ searchQuery: 'Unpublished Audio Track' })
    assert.equal(catalog.length, 0, 'Catalog query by regular user must yield 0 results for draft')
  })

  // --------------------------------------------------------------------------
  // Verification Scenario 3: Admin publishes the track -> regular user can see and play it
  // --------------------------------------------------------------------------
  it('Scenario 3: Admin publishes track -> regular users can see, search, and play it', async () => {
    const publishedMetadata: MusicTrack = {
      ...sampleTrack,
      providerTrackId: 'spotify_published_success_789',
      title: 'Blinding Lights (Published)',
      artistName: 'The Weeknd',
    }

    const publishResult = await uploadAndPublishCatalogTrack({
      userEmail: ADMIN_EMAIL,
      userId: 'admin-id-123',
      track: publishedMetadata,
      audioFile: dummyAudioFile,
      fileName: 'blinding_lights.mp3',
    })

    assert.equal(publishResult.success, true)
    assert.ok(publishResult.catalogTrack)
    assert.equal(publishResult.catalogTrack.publicationStatus, 'published')
    assert.ok(publishResult.catalogTrack.storagePath, 'Storage path must be recorded')
    assert.ok(publishResult.catalogTrack.audioUrl, 'Audio playback URL must be recorded')

    // Regular user can find it in public catalog
    const publicCatalog = await fetchPublishedCatalogTracks({
      searchQuery: 'Blinding Lights (Published)',
    })
    const found = publicCatalog.find((t) => t.providerTrackId === 'spotify_published_success_789')
    assert.ok(found, 'Regular user must be able to search and discover published track')
    assert.equal(found.isPlayable, true, 'Published track must be playable for regular users')
    assert.ok(found.playbackUrl, 'Published track must contain valid playbackUrl for regular users')
    assert.ok(found.audioSourceUrl, 'audioSourceUrl must match playbackUrl')
    assert.equal(found.publicationStatus, 'published')

    // Regular user can access it directly
    const direct = getCatalogTrack(publishResult.catalogTrack.id, REGULAR_USER_EMAIL)
    assert.ok(direct, 'Regular user can view published catalog track')
    assert.equal(direct.publicationStatus, 'published')
  })

  // --------------------------------------------------------------------------
  // Verification Scenario 4: Admin unpublishes the track -> regular user loses access
  // --------------------------------------------------------------------------
  it('Scenario 4: Admin unpublishes track -> regular users lose catalog visibility and playback', async () => {
    const trackToUnpublish: MusicTrack = {
      ...sampleTrack,
      providerTrackId: 'spotify_to_unpublish_999',
      title: 'Temporary Hit Track',
    }

    const pubRes = await uploadAndPublishCatalogTrack({
      userEmail: ADMIN_EMAIL,
      userId: 'admin-id-123',
      track: trackToUnpublish,
      audioFile: dummyAudioFile,
      fileName: 'temp_hit.mp3',
    })
    assert.equal(pubRes.success, true)
    const trackId = pubRes.catalogTrack!.id

    // Confirm it was visible
    const beforeUnpublish = getCatalogTrack(trackId, REGULAR_USER_EMAIL)
    assert.ok(beforeUnpublish, 'Should be visible before unpublishing')

    // Admin unpublishes
    const unpubRes = await unpublishCatalogTrack({
      trackId,
      userEmail: ADMIN_EMAIL,
    })
    assert.equal(unpubRes.success, true)

    // Regular user direct access is now denied
    const afterUnpublish = getCatalogTrack(trackId, REGULAR_USER_EMAIL)
    assert.equal(afterUnpublish, null, 'Regular user access to unpublished track must return null')

    // Catalog search yields nothing
    const searchAfter = await fetchPublishedCatalogTracks({ searchQuery: 'Temporary Hit Track' })
    const foundAfter = searchAfter.find((t) => t.providerTrackId === 'spotify_to_unpublish_999')
    assert.equal(foundAfter, undefined, 'Unpublished track must not appear in search results')
  })

  // --------------------------------------------------------------------------
  // Verification Scenario 5: Direct access to draft ID is denied for regular users
  // --------------------------------------------------------------------------
  it('Scenario 5: Regular user direct access to draft IDs is strictly denied', async () => {
    const draftTrack: MusicTrack = {
      ...sampleTrack,
      providerTrackId: 'spotify_private_draft_000',
      title: 'Private Unreleased Demo',
    }

    const draft = await createDraftCatalogTrack({
      userEmail: ADMIN_EMAIL,
      userId: 'admin-id-123',
      track: draftTrack,
    })

    // User attempts lookup by catalog ID
    const directUserAccess = getCatalogTrack(draft.id, REGULAR_USER_EMAIL)
    assert.equal(directUserAccess, null, 'Direct lookup by draft ID must return null for regular users')

    // User attempts lookup by provider track ID
    const directProviderAccess = getCatalogTrack(draft.providerTrackId, REGULAR_USER_EMAIL)
    assert.equal(directProviderAccess, null, 'Direct lookup by provider ID must return null for regular users')

    // Admin CAN look it up directly
    const directAdminAccess = getCatalogTrack(draft.id, ADMIN_EMAIL)
    assert.ok(directAdminAccess, 'Admin can look up draft by ID')
    assert.equal(directAdminAccess.id, draft.id)
  })

  // --------------------------------------------------------------------------
  // Verification Scenario 6: Playlist Membership Separation (No Duplicate Audio)
  // --------------------------------------------------------------------------
  it('Scenario 6: Two different users add the same published track to different playlists without duplicating audio', async () => {
    // 1. Admin publishes track to global catalog
    const sharedTrackMeta: MusicTrack = {
      ...sampleTrack,
      providerTrackId: 'spotify_shared_anthem_444',
      title: 'Universal Anthem',
      artistName: 'ORBIM Artists',
    }

    const publishRes = await uploadAndPublishCatalogTrack({
      userEmail: ADMIN_EMAIL,
      userId: 'admin-id-123',
      track: sharedTrackMeta,
      audioFile: dummyAudioFile,
      fileName: 'universal_anthem.mp3',
    })
    assert.equal(publishRes.success, true)
    const catalogTrack = publishRes.catalogTrack!
    const publishedMusicTrack = mapCatalogRecordToMusicTrack(catalogTrack)

    // 2. User 1 builds playlist row for their playlist
    const user1PlaylistId = '11111111-1111-4111-8111-111111111111'
    const user1Row = buildPlaylistTrackRow({
      playlistId: user1PlaylistId,
      track: publishedMusicTrack,
      userId: 'user-1-uuid',
      position: 1000.0,
      addedVia: 'web_ui',
    })

    // 3. User 2 builds playlist row for their playlist
    const user2PlaylistId = '22222222-2222-4222-8222-222222222222'
    const user2Row = buildPlaylistTrackRow({
      playlistId: user2PlaylistId,
      track: publishedMusicTrack,
      userId: 'user-2-uuid',
      position: 1000.0,
      addedVia: 'web_ui',
    })

    // Both rows must point to the identical catalogTrackId and storagePath
    assert.equal(user1Row.catalog_track_id, catalogTrack.id)
    assert.equal(user2Row.catalog_track_id, catalogTrack.id)
    assert.equal(user1Row.storage_path, catalogTrack.storagePath)
    assert.equal(user2Row.storage_path, catalogTrack.storagePath)
    assert.equal(user1Row.audio_url, catalogTrack.audioUrl)
    assert.equal(user2Row.audio_url, catalogTrack.audioUrl)

    // Playlists are separate
    assert.notEqual(user1Row.playlist_id, user2Row.playlist_id)
    assert.notEqual(user1Row.added_by, user2Row.added_by)
  })

  // --------------------------------------------------------------------------
  // Verification Scenario 7: Regular user cannot add unpublished track to playlist
  // --------------------------------------------------------------------------
  it('Scenario 7: Regular user attempting to add an unpublished or draft track to playlist is rejected', async () => {
    const draftTrack: MusicTrack = {
      ...sampleTrack,
      providerTrackId: 'spotify_draft_block_add',
      title: 'Blocked Draft Song',
      publicationStatus: 'draft',
    }

    const draftRecord = await createDraftCatalogTrack({
      userEmail: ADMIN_EMAIL,
      userId: 'admin-id-123',
      track: draftTrack,
    })

    const attemptTrack = mapCatalogRecordToMusicTrack(draftRecord)

    // Regular user attempts to add draft track to playlist
    const addResult = await addTrackToUserPlaylist({
      playlistId: 'user-playlist-id',
      track: attemptTrack,
    })

    assert.equal(addResult.success, false)
    assert.ok(addResult.error)
    assert.match(addResult.error.message, /Cannot add unpublished track/i)
  })

  // --------------------------------------------------------------------------
  // Verification Scenario 8: Tracks without audio are strictly excluded from published catalog
  // --------------------------------------------------------------------------
  it('Scenario 8: Tracks without confirmed audio are strictly excluded from fetchPublishedCatalogTracks', async () => {
    // 1. Create a draft track that has NO audio
    const noAudioTrack: MusicTrack = {
      ...sampleTrack,
      providerTrackId: 'spotify_no_audio_9999',
      title: 'Silent Track No Audio',
      isPlayable: false,
    }

    const draft = await createDraftCatalogTrack({
      userEmail: ADMIN_EMAIL,
      userId: 'admin-id-123',
      track: noAudioTrack,
    })

    // Force its publication status to 'published' without giving it audio (simulating edge case/inconsistent row)
    draft.publicationStatus = 'published'

    // Fetch published catalog tracks
    const published = await fetchPublishedCatalogTracks({ searchQuery: 'Silent Track No Audio' })
    const found = published.find((t) => t.providerTrackId === 'spotify_no_audio_9999')

    assert.equal(found, undefined, 'A track without audio must never appear in fetchPublishedCatalogTracks')

    // Regular user looking up via getCatalogTrack also receives null because audio is missing
    const userView = getCatalogTrack(draft.id, REGULAR_USER_EMAIL)
    assert.equal(userView, null, 'Regular user cannot access published track that has no audio')

    // Now upload and publish valid audio for a track
    const withAudioTrack: MusicTrack = {
      ...sampleTrack,
      providerTrackId: 'spotify_with_audio_8888',
      title: 'Audible Hit Song',
    }

    const pubRes = await uploadAndPublishCatalogTrack({
      userEmail: ADMIN_EMAIL,
      userId: 'admin-id-123',
      track: withAudioTrack,
      audioFile: dummyAudioFile,
      fileName: 'audible_hit.mp3',
    })
    assert.equal(pubRes.success, true)

    // Verify it appears in published catalog and is playable
    const publishedWithAudio = await fetchPublishedCatalogTracks({ searchQuery: 'Audible Hit Song' })
    const foundWithAudio = publishedWithAudio.find((t) => t.providerTrackId === 'spotify_with_audio_8888')

    assert.ok(foundWithAudio, 'Track with confirmed audio must appear in fetchPublishedCatalogTracks')
    assert.equal(foundWithAudio.isPlayable, true, 'Track with confirmed audio must be isPlayable: true')
    assert.ok(foundWithAudio.playbackUrl, 'Track with confirmed audio must have playbackUrl')
  })

  // --------------------------------------------------------------------------
  // Rule Check: Migration 8 & Unified Schema Consistency
  // --------------------------------------------------------------------------
  it('verifies Migration 8 and Unified Schema implement required catalog constraints and RLS', () => {
    const migration8Path = path.resolve('supabase/migrations/20261101000008_global_music_catalog.sql')
    const schemaPath = path.resolve('supabase/schema.sql')

    assert.ok(fs.existsSync(migration8Path), 'Migration 8 file must exist')
    const migration8Sql = fs.readFileSync(migration8Path, 'utf-8')
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8')

    // Check table creation
    assert.ok(migration8Sql.includes('CREATE TABLE IF NOT EXISTS public.catalog_tracks'))
    assert.ok(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.catalog_tracks'))

    // Check catalog_track_id reference
    assert.ok(migration8Sql.includes('ADD COLUMN IF NOT EXISTS catalog_track_id UUID'))
    assert.ok(schemaSql.includes('catalog_track_id UUID REFERENCES public.catalog_tracks(id)'))

    // Check RLS policies
    assert.ok(migration8Sql.includes('catalog_tracks_select_policy'))
    assert.ok(migration8Sql.includes('catalog_tracks_insert_admin'))
    assert.ok(migration8Sql.includes('catalog_tracks_update_admin'))
    assert.ok(migration8Sql.includes('catalog_tracks_delete_admin'))

    // Check published integrity constraint
    assert.ok(migration8Sql.includes('catalog_tracks_published_integrity'))
    assert.ok(schemaSql.includes('catalog_tracks_published_integrity'))

    // Check publication stored procedures
    assert.ok(migration8Sql.includes('CREATE OR REPLACE FUNCTION public.publish_catalog_track'))
    assert.ok(migration8Sql.includes('CREATE OR REPLACE FUNCTION public.unpublish_catalog_track'))
  })
})
