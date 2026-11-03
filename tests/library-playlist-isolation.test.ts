import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { mockPlaylists } from '../src/data/mock/index.ts'
import {
  computeLibraryCounts,
  mapSupabasePlaylistRow,
  mapSupabasePlaylistRows,
  resolveLibraryPlaylists,
  type SupabasePlaylistRow,
} from '../src/services/playlist/library-state.ts'

describe('Library Page: Playlist Isolation & Demo Data Decoupling', () => {
  const currentUserId = '11111111-1111-4111-8111-111111111111'
  const otherUserId = '22222222-2222-4222-8222-222222222222'

  const singleRemoteRow: SupabasePlaylistRow = {
    id: '33333333-3333-4333-8333-333333333333',
    owner_id: currentUserId,
    title: 'Playlist Gw',
    description: 'My personal cloud playlist',
    visibility: 'private',
    created_at: '2026-10-25T10:00:00.000Z',
    updated_at: '2026-10-25T10:30:00.000Z',
  }

  const sharedRemoteRow: SupabasePlaylistRow = {
    id: '44444444-4444-4444-8444-444444444444',
    owner_id: otherUserId,
    title: 'Shared Jam',
    description: 'Collaborative space',
    visibility: 'shared',
    created_at: '2026-10-25T11:00:00.000Z',
    updated_at: '2026-10-25T11:45:00.000Z',
  }

  it('verifies mock catalog contains 7 default playlists for baseline check', () => {
    assert.equal(
      mockPlaylists.length,
      7,
      'Mock catalog should contain 7 demo playlists for baseline',
    )
  })

  it('P0 fix: authenticated user with 1 remote playlist resolves strictly to count 1, NOT 8', () => {
    const singleRemotePlaylist = mapSupabasePlaylistRow(
      singleRemoteRow,
      currentUserId,
      'Ahmad',
    )

    const resolved = resolveLibraryPlaylists({
      user: { id: currentUserId },
      isDemo: false,
      remotePlaylists: [singleRemotePlaylist],
      mockPlaylists,
    })

    // Must NOT combine with 7 mock playlists (1 + 7 = 8 was the bug)
    assert.equal(resolved.length, 1, 'Resolved playlists count must be 1, not 8')
    assert.equal(resolved[0].title, 'Playlist Gw')
    assert.equal(resolved[0].owner.id, currentUserId)
    assert.equal(resolved[0].owner.displayName, 'Ahmad')

    const counts = computeLibraryCounts(resolved, currentUserId)
    assert.equal(counts.all, 1, 'Total count must be exactly 1')
    assert.equal(counts.owned, 1, 'Owned count must be exactly 1')
    assert.equal(counts.shared, 0, 'Shared count must be exactly 0')
  })

  it('P0 fix: authenticated user in demo environment STILL receives strictly their own playlists', () => {
    const singleRemotePlaylist = mapSupabasePlaylistRow(
      singleRemoteRow,
      currentUserId,
      'Ahmad',
    )

    const resolved = resolveLibraryPlaylists({
      user: { id: currentUserId },
      isDemo: true, // Even if app is running in demo mode
      remotePlaylists: [singleRemotePlaylist],
      mockPlaylists,
    })

    assert.equal(
      resolved.length,
      1,
      'Authenticated user must never have mock playlists injected, even in demo mode',
    )
    assert.equal(resolved[0].title, 'Playlist Gw')
  })

  it('empty state: authenticated user with 0 remote playlists does NOT fall back to mock data', () => {
    const resolved = resolveLibraryPlaylists({
      user: { id: currentUserId },
      isDemo: false,
      remotePlaylists: [],
      mockPlaylists,
    })

    assert.equal(resolved.length, 0, 'Empty remote playlists must resolve to empty array')
    const counts = computeLibraryCounts(resolved, currentUserId)
    assert.equal(counts.all, 0)
    assert.equal(counts.owned, 0)
    assert.equal(counts.shared, 0)
  })

  it('differentiates owned vs shared remote playlists accurately', () => {
    const remoteList = mapSupabasePlaylistRows(
      [singleRemoteRow, sharedRemoteRow],
      currentUserId,
      'Ahmad',
    )

    const resolved = resolveLibraryPlaylists({
      user: { id: currentUserId },
      isDemo: false,
      remotePlaylists: remoteList,
      mockPlaylists,
    })

    assert.equal(resolved.length, 2)
    const counts = computeLibraryCounts(resolved, currentUserId)
    assert.equal(counts.all, 2)
    assert.equal(counts.owned, 1, 'Must count 1 owned playlist')
    assert.equal(counts.shared, 1, 'Must count 1 shared playlist')
  })

  it('guest preview in demo mode returns mock catalog', () => {
    const resolved = resolveLibraryPlaylists({
      user: null,
      isDemo: true,
      remotePlaylists: [],
      mockPlaylists,
    })

    assert.equal(
      resolved.length,
      mockPlaylists.length,
      'Unauthenticated visitor in demo mode receives mock catalog preview',
    )
  })

  it('guest in Supabase mode returns empty array (requires authentication)', () => {
    const resolved = resolveLibraryPlaylists({
      user: null,
      isDemo: false,
      remotePlaylists: [],
      mockPlaylists,
    })

    assert.equal(
      resolved.length,
      0,
      'Unauthenticated visitor in Supabase mode receives empty list',
    )
  })

  it('correctly maps Supabase playlist rows with ownership and display names', () => {
    const mappedOwned = mapSupabasePlaylistRow(singleRemoteRow, currentUserId, 'Tester')
    assert.equal(mappedOwned.id, singleRemoteRow.id)
    assert.equal(mappedOwned.title, 'Playlist Gw')
    assert.equal(mappedOwned.description, 'My personal cloud playlist')
    assert.equal(mappedOwned.owner.id, currentUserId)
    assert.equal(mappedOwned.owner.displayName, 'Tester')
    assert.equal(mappedOwned.visibility, 'private')
    assert.deepEqual(mappedOwned.collaborators, [])
    assert.deepEqual(mappedOwned.trackEntries, [])

    const mappedShared = mapSupabasePlaylistRow(sharedRemoteRow, currentUserId, 'Tester')
    assert.equal(mappedShared.owner.id, otherUserId)
    assert.equal(mappedShared.owner.displayName, 'Collaborator')
    assert.equal(mappedShared.visibility, 'shared')
  })

  it('safely handles missing description and fallback display name', () => {
    const minimalRow: SupabasePlaylistRow = {
      id: '55555555-5555-4555-8555-555555555555',
      owner_id: currentUserId,
      title: 'Minimal Playlist',
      description: null,
      visibility: 'public',
      created_at: '2026-10-25T12:00:00.000Z',
      updated_at: '2026-10-25T12:00:00.000Z',
    }

    const mapped = mapSupabasePlaylistRow(minimalRow, currentUserId, null)
    assert.equal(mapped.description, undefined)
    assert.equal(mapped.owner.displayName, 'You')
  })
})
