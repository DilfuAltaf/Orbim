import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { mockPlaylists } from '../src/data/mock/index.ts'
import {
  mapSupabasePlaylistRow,
  mapSupabasePlaylistRows,
  type SupabasePlaylistRow,
} from '../src/services/playlist/library-state.ts'
import { resolveSidebarPlaylists } from '../src/services/playlist/sidebar-playlists.ts'
import type { Playlist } from '../src/types/music.ts'

describe('Sidebar Playlists: Resolution, Isolation & Ordering', () => {
  const currentUserId = '11111111-1111-4111-8111-111111111111'
  const otherUserId = '22222222-2222-4222-8222-222222222222'

  const makeRow = (id: string, title: string, updatedAt: string, ownerId = currentUserId): SupabasePlaylistRow => ({
    id,
    owner_id: ownerId,
    title,
    description: null,
    visibility: 'private',
    created_at: '2026-10-25T10:00:00.000Z',
    updated_at: updatedAt,
  })

  it('user memiliki 1 playlist remote: ditampilkan tepat 1 tanpa mock playlist', () => {
    const singleRow = makeRow(
      '00000000-0000-0000-0000-000000000001',
      'Playlist Gw',
      '2026-10-25T12:00:00.000Z',
    )
    const singlePlaylist = mapSupabasePlaylistRow(singleRow, currentUserId, 'Tester')

    const result = resolveSidebarPlaylists({
      user: { id: currentUserId },
      isDemo: false,
      remotePlaylists: [singlePlaylist],
      mockPlaylists,
      limit: 4,
    })

    assert.equal(result.length, 1, 'Sidebar harus menampilkan tepat 1 playlist')
    assert.equal(result[0].title, 'Playlist Gw')
    assert.equal(result[0].id, singleRow.id)
  })

  it('user memiliki lebih dari 4 playlist: hanya 4 terbaru berdasarkan updatedAt yang ditampilkan', () => {
    const rows: SupabasePlaylistRow[] = [
      makeRow('p1', 'Song List 1', '2026-10-20T10:00:00.000Z'), // oldest
      makeRow('p2', 'Song List 2', '2026-10-21T10:00:00.000Z'),
      makeRow('p3', 'Song List 3', '2026-10-22T10:00:00.000Z'),
      makeRow('p4', 'Song List 4', '2026-10-23T10:00:00.000Z'),
      makeRow('p5', 'Song List 5', '2026-10-24T10:00:00.000Z'),
      makeRow('p6', 'Song List 6', '2026-10-25T10:00:00.000Z'), // newest
    ]

    const playlists = mapSupabasePlaylistRows(rows, currentUserId, 'Tester')

    const result = resolveSidebarPlaylists({
      user: { id: currentUserId },
      isDemo: false,
      remotePlaylists: playlists,
      mockPlaylists,
      limit: 4,
    })

    assert.equal(result.length, 4, 'Sidebar harus membatasi maksimal 4 playlist')
    assert.equal(result[0].title, 'Song List 6', 'Urutan ke-1 harus paling baru (p6)')
    assert.equal(result[1].title, 'Song List 5', 'Urutan ke-2 harus p5')
    assert.equal(result[2].title, 'Song List 4', 'Urutan ke-3 harus p4')
    assert.equal(result[3].title, 'Song List 3', 'Urutan ke-4 harus p3')

    // p1 dan p2 tidak boleh masuk karena lebih lama
    assert.ok(!result.some((p) => p.title === 'Song List 1'))
    assert.ok(!result.some((p) => p.title === 'Song List 2'))
  })

  it('guest tidak melihat playlist privat remote', () => {
    const rows = [
      makeRow('p1', 'Private Personal Playlist', '2026-10-25T12:00:00.000Z'),
    ]
    const remotePlaylists = mapSupabasePlaylistRows(rows, currentUserId, 'Tester')

    // Di mode Supabase
    const guestSupabase = resolveSidebarPlaylists({
      user: null,
      isDemo: false,
      remotePlaylists,
      mockPlaylists,
    })
    assert.equal(guestSupabase.length, 0, 'Guest di mode Supabase tidak boleh melihat playlist remote')

    // Di mode Demo
    const guestDemo = resolveSidebarPlaylists({
      user: null,
      isDemo: true,
      remotePlaylists,
      mockPlaylists,
    })
    // Guest di demo mode hanya melihat mock catalog, BUKAN playlist remote pribadi
    assert.ok(!guestDemo.some((p) => p.title === 'Private Personal Playlist'))
  })

  it('mode Supabase tidak mencampurkan mock playlist untuk user maupun guest', () => {
    const singlePlaylist: Playlist = mapSupabasePlaylistRow(
      makeRow('p1', 'Supabase Cloud Playlist', '2026-10-25T12:00:00.000Z'),
      currentUserId,
    )

    // Authenticated
    const authResult = resolveSidebarPlaylists({
      user: { id: currentUserId },
      isDemo: false,
      remotePlaylists: [singlePlaylist],
      mockPlaylists,
    })
    assert.equal(authResult.length, 1)
    assert.equal(authResult[0].title, 'Supabase Cloud Playlist')

    // Guest
    const guestResult = resolveSidebarPlaylists({
      user: null,
      isDemo: false,
      remotePlaylists: [singlePlaylist],
      mockPlaylists,
    })
    assert.equal(guestResult.length, 0)
  })

  it('error fetching tidak menyebabkan fallback ke mock', () => {
    // Saat fetching gagal, remotePlaylists bernilai []
    const result = resolveSidebarPlaylists({
      user: { id: currentUserId },
      isDemo: false,
      remotePlaylists: [],
      mockPlaylists,
    })

    assert.equal(result.length, 0, 'Error/empty remote playlist tidak boleh fallback ke mock')
  })

  it('menyaring hanya playlist yang dimiliki user (bukan shared/collaborator)', () => {
    const rows: SupabasePlaylistRow[] = [
      makeRow('p1', 'Owned by User', '2026-10-25T12:00:00.000Z', currentUserId),
      makeRow('p2', 'Shared by Someone Else', '2026-10-25T13:00:00.000Z', otherUserId),
    ]

    const playlists = mapSupabasePlaylistRows(rows, currentUserId, 'Tester')

    const result = resolveSidebarPlaylists({
      user: { id: currentUserId },
      isDemo: false,
      remotePlaylists: playlists,
      mockPlaylists,
    })

    assert.equal(result.length, 1, 'Sidebar hanya menampilkan playlist milik user')
    assert.equal(result[0].title, 'Owned by User')
    assert.equal(result[0].owner.id, currentUserId)
  })

  it('mode demo untuk guest menampilkan maksimal 4 demo playlist milik viewer', () => {
    const result = resolveSidebarPlaylists({
      user: null,
      isDemo: true,
      remotePlaylists: [],
      mockPlaylists,
      limit: 4,
    })

    assert.ok(result.length > 0 && result.length <= 4)
  })
})
