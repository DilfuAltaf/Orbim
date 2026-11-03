import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { mockPlaylists } from '../src/data/mock/index.ts'
import {
  resolveHomePlaylists,
  resolveHomeRecentTracks,
} from '../src/services/playlist/home-playlists.ts'
import {
  mapSupabasePlaylistRows,
  type SupabasePlaylistRow,
} from '../src/services/playlist/library-state.ts'

describe('HomePage Data Resolution, Isolation & Honesty Policy', () => {
  const currentUserId = '11111111-1111-4111-8111-111111111111'
  const otherUserId = '22222222-2222-4222-8222-222222222222'

  const makeRow = (
    id: string,
    title: string,
    updatedAt: string,
    ownerId = currentUserId,
  ): SupabasePlaylistRow => ({
    id,
    owner_id: ownerId,
    title,
    description: null,
    visibility: ownerId === currentUserId ? 'private' : 'shared',
    created_at: '2026-10-25T10:00:00.000Z',
    updated_at: updatedAt,
  })

  describe('User Playlists Isolation on HomePage', () => {
    it('memisahkan owned vs shared playlists secara akurat berdasarkan owner_id', () => {
      const rows: SupabasePlaylistRow[] = [
        makeRow('p1', 'My Playlist 1', '2026-10-25T11:00:00.000Z', currentUserId),
        makeRow('p2', 'My Playlist 2', '2026-10-25T12:00:00.000Z', currentUserId),
        makeRow('p3', 'Collab Playlist 1', '2026-10-25T10:00:00.000Z', otherUserId),
      ]
      const playlists = mapSupabasePlaylistRows(rows, currentUserId, 'Tester')

      const { ownPlaylists, sharedPlaylists } = resolveHomePlaylists({
        user: { id: currentUserId },
        isDemo: false,
        remotePlaylists: playlists,
        mockPlaylists,
      })

      assert.equal(ownPlaylists.length, 2, 'Harus memiliki 2 playlist milik sendiri')
      assert.equal(sharedPlaylists.length, 1, 'Harus memiliki 1 playlist shared')
      assert.equal(ownPlaylists[0].title, 'My Playlist 2', 'Urutan pertama harus yang terbaru')
      assert.equal(sharedPlaylists[0].title, 'Collab Playlist 1')
    })

    it('tidak mencampurkan mock playlist ke dalam data pengguna di mode Supabase', () => {
      const rows: SupabasePlaylistRow[] = [
        makeRow('p1', 'Solo Cloud', '2026-10-25T12:00:00.000Z', currentUserId),
      ]
      const playlists = mapSupabasePlaylistRows(rows, currentUserId, 'Tester')

      const { ownPlaylists, sharedPlaylists } = resolveHomePlaylists({
        user: { id: currentUserId },
        isDemo: false,
        remotePlaylists: playlists,
        mockPlaylists,
      })

      assert.equal(ownPlaylists.length, 1)
      assert.equal(sharedPlaylists.length, 0)
      assert.equal(ownPlaylists[0].title, 'Solo Cloud')
      // Memastikan tidak ada playlist mock yang menyusup
      assert.ok(!ownPlaylists.some((p) => p.title.includes('Coffeehouse')))
    })

    it('kondisi kosong: user dengan 0 playlist tidak fallback ke mock data', () => {
      const { ownPlaylists, sharedPlaylists } = resolveHomePlaylists({
        user: { id: currentUserId },
        isDemo: false,
        remotePlaylists: [],
        mockPlaylists,
      })

      assert.equal(ownPlaylists.length, 0, 'Harus tetap kosong dan jujur')
      assert.equal(sharedPlaylists.length, 0, 'Harus tetap kosong dan jujur')
    })

    it('error fetching (remotePlaylists = []): tidak diam-diam menampilkan data demo', () => {
      const { ownPlaylists, sharedPlaylists } = resolveHomePlaylists({
        user: { id: currentUserId },
        isDemo: false,
        remotePlaylists: [],
        mockPlaylists,
      })

      assert.deepEqual(ownPlaylists, [])
      assert.deepEqual(sharedPlaylists, [])
    })
  })

  describe('Guest Access & Privacy Protection on HomePage', () => {
    it('guest di mode Supabase tidak melihat playlist privat pengguna maupun mock data', () => {
      const rows = [makeRow('p1', 'Private Vault', '2026-10-25T12:00:00.000Z', currentUserId)]
      const remotePlaylists = mapSupabasePlaylistRows(rows, currentUserId, 'Tester')

      const { ownPlaylists, sharedPlaylists } = resolveHomePlaylists({
        user: null,
        isDemo: false,
        remotePlaylists,
        mockPlaylists,
      })

      assert.equal(ownPlaylists.length, 0, 'Guest tidak boleh melihat playlist privat')
      assert.equal(sharedPlaylists.length, 0)
    })

    it('guest di mode demo dapat melihat katalog demo terpisah', () => {
      const { ownPlaylists, sharedPlaylists } = resolveHomePlaylists({
        user: null,
        isDemo: true,
        remotePlaylists: [],
        mockPlaylists,
      })

      assert.ok(ownPlaylists.length > 0, 'Mode demo menampilkan demo catalog untuk preview')
      assert.ok(sharedPlaylists.length > 0)
    })
  })

  describe('Recent Tracks Honesty Policy', () => {
    it('di mode Supabase: recent tracks mengembalikan array kosong karena schema belum menyimpan playback history', () => {
      const tracks = resolveHomeRecentTracks({
        isDemo: false,
        limit: 5,
      })

      assert.equal(
        tracks.length,
        0,
        'Tidak boleh berpura-pura bahwa mock tracks adalah riwayat pemutaran asli di mode Supabase',
      )
    })

    it('di mode demo: recent tracks mengembalikan trek demo statis', () => {
      const tracks = resolveHomeRecentTracks({
        isDemo: true,
        limit: 5,
      })

      assert.equal(tracks.length, 5, 'Mode demo menampilkan 5 demo tracks')
    })

    it('di mode live: recent tracks memakai baris Supabase dan membuang duplikat', () => {
      const liveTracks = [
        {
          provider: 'spotify' as const,
          providerTrackId: 'sp-1',
          title: 'Track Satu',
          artistName: 'Artist X',
          durationSeconds: 120,
          genre: 'Spotify',
          moods: [],
          isPlayable: false,
        },
        {
          provider: 'spotify' as const,
          providerTrackId: 'sp-1',
          title: 'Track Satu',
          artistName: 'Artist X',
          durationSeconds: 120,
          genre: 'Spotify',
          moods: [],
          isPlayable: false,
        },
        {
          provider: 'orbim' as const,
          providerTrackId: 'orb-1',
          title: 'Track Dua',
          artistName: 'Artist Y',
          durationSeconds: 90,
          genre: 'ORBIM Catalog',
          moods: [],
          isPlayable: false,
        },
      ]

      const tracks = resolveHomeRecentTracks({
        isDemo: false,
        limit: 5,
        remoteTracks: liveTracks,
      })

      assert.equal(tracks.length, 2, 'Duplikat track harus dibuang')
      assert.equal(tracks[0].providerTrackId, 'sp-1')
      assert.equal(tracks[1].providerTrackId, 'orb-1')
    })
  })
})
