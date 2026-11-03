import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isSharedWithViewer, mockPlaylists } from '../src/data/mock/index.ts'
import {
  mapSupabasePlaylistRows,
  type SupabasePlaylistRow,
} from '../src/services/playlist/library-state.ts'
import { resolveSharedPlaylists } from '../src/services/playlist/shared-playlists.ts'

describe('SharedPage Data Resolution, Isolation & Honesty Policy', () => {
  const currentUserId = '11111111-1111-4111-8111-111111111111'
  const otherUserId = '22222222-2222-4222-8222-222222222222'
  const thirdUserId = '33333333-3333-4333-8333-333333333333'

  const makeRow = (
    id: string,
    title: string,
    updatedAt: string,
    ownerId: string,
  ): SupabasePlaylistRow => ({
    id,
    owner_id: ownerId,
    title,
    description: null,
    visibility: ownerId === currentUserId ? 'private' : 'shared',
    created_at: '2026-10-25T10:00:00.000Z',
    updated_at: updatedAt,
  })

  describe('Isolation and Ownership Separation', () => {
    it('memisahkan owned playlist dan hanya menampilkan playlist milik creator lain', () => {
      const rows: SupabasePlaylistRow[] = [
        makeRow('p1', 'My Personal Mix', '2026-10-25T14:00:00.000Z', currentUserId),
        makeRow('p2', 'Shared From Alice', '2026-10-25T12:00:00.000Z', otherUserId),
        makeRow('p3', 'Shared From Bob', '2026-10-25T15:00:00.000Z', thirdUserId),
      ]
      const playlists = mapSupabasePlaylistRows(rows, currentUserId, 'Tester')

      const shared = resolveSharedPlaylists({
        user: { id: currentUserId },
        isDemo: false,
        remotePlaylists: playlists,
        mockPlaylists,
      })

      assert.equal(shared.length, 2, 'Harus mengecualikan playlist milik sendiri')
      assert.equal(shared[0].title, 'Shared From Bob', 'Urutan pertama harus yang paling baru diupdate')
      assert.equal(shared[1].title, 'Shared From Alice')
      assert.ok(
        shared.every((p) => p.owner.id !== currentUserId),
        'Semua playlist shared harus memiliki owner_id yang berbeda dari pengguna yang login',
      )
    })

    it('tidak pernah mencampurkan mock playlist ke dalam data Supabase', () => {
      const rows: SupabasePlaylistRow[] = [
        makeRow('p-collab', 'Real Collab Session', '2026-10-25T12:00:00.000Z', otherUserId),
      ]
      const playlists = mapSupabasePlaylistRows(rows, currentUserId, 'Tester')

      const shared = resolveSharedPlaylists({
        user: { id: currentUserId },
        isDemo: false,
        remotePlaylists: playlists,
        mockPlaylists,
      })

      assert.equal(shared.length, 1)
      assert.equal(shared[0].id, 'p-collab')
      const mockIds = new Set(mockPlaylists.map((m) => m.id))
      assert.ok(!mockIds.has(shared[0].id), 'ID playlist tidak boleh berasal dari mock data')
    })

    it('mengembalikan array kosong jika user tidak memiliki playlist shared (tanpa fallback ke mock)', () => {
      const rows: SupabasePlaylistRow[] = [
        makeRow('p1', 'Only Mine 1', '2026-10-25T12:00:00.000Z', currentUserId),
        makeRow('p2', 'Only Mine 2', '2026-10-25T13:00:00.000Z', currentUserId),
      ]
      const playlists = mapSupabasePlaylistRows(rows, currentUserId, 'Tester')

      const shared = resolveSharedPlaylists({
        user: { id: currentUserId },
        isDemo: false,
        remotePlaylists: playlists,
        mockPlaylists,
      })

      assert.equal(shared.length, 0, 'Harus kosong saat semua playlist adalah milik user')
    })

    it('mengembalikan array kosong saat remotePlaylists kosong karena error atau belum ada data', () => {
      const shared = resolveSharedPlaylists({
        user: { id: currentUserId },
        isDemo: false,
        remotePlaylists: [],
        mockPlaylists,
      })

      assert.deepEqual(shared, [], 'Tidak boleh jatuh kembali ke mock data saat remote query kosong')
    })
  })

  describe('Guest Access and Demo Mode Boundaries', () => {
    it('mengembalikan array kosong untuk guest di mode Supabase (mencegah kebocoran data privat)', () => {
      const shared = resolveSharedPlaylists({
        user: null,
        isDemo: false,
        remotePlaylists: [],
        mockPlaylists,
      })

      assert.deepEqual(shared, [], 'Guest di mode Supabase tidak boleh melihat data mock atau privat')
    })

    it('mengembalikan mock shared playlists hanya jika mode Demo aktif', () => {
      const sharedGuest = resolveSharedPlaylists({
        user: null,
        isDemo: true,
        remotePlaylists: [],
        mockPlaylists,
      })

      assert.ok(sharedGuest.length > 0, 'Mode demo harus mengembalikan mock shared playlists')
      assert.ok(
        sharedGuest.every((p) => isSharedWithViewer(p)),
        'Setiap playlist harus memenuhi filter isSharedWithViewer di mode demo',
      )

      const sharedAuth = resolveSharedPlaylists({
        user: { id: currentUserId },
        isDemo: true,
        remotePlaylists: [],
        mockPlaylists,
      })

      assert.equal(
        sharedAuth.length,
        sharedGuest.length,
        'Mode demo harus konsisten untuk guest maupun demo user',
      )
    })
  })
})
