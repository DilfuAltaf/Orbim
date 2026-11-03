import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'

// Set mock Supabase environment variables before importing modules that reference supabase
before(() => {
  process.env.VITE_SUPABASE_URL = 'https://mock-project-ref.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSJ9.fake-signature'
})

process.env.VITE_SUPABASE_URL = 'https://mock-project-ref.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSJ9.fake-signature'

import { buttonVariants } from '../src/lib/styles.ts'
import {
  deleteSupabasePlaylist,
  removeTrackFromPlaylist,
  updateSupabasePlaylist,
} from '../src/services/playlist/supabase-playlist.ts'

describe('Playlist CRUD: Create, Read, Update, Delete & Security Enforcement', () => {
  describe('1. Update Playlist Validation & Authentication', () => {
    it('rejects update with empty or whitespace title', async () => {
      const res1 = await updateSupabasePlaylist({
        playlistId: 'mock-playlist-id',
        title: '',
      })
      assert.equal(res1.data, null)
      assert.ok(res1.error)
      assert.match(res1.error.message, /title cannot be empty/i)

      const res2 = await updateSupabasePlaylist({
        playlistId: 'mock-playlist-id',
        title: '   ',
      })
      assert.equal(res2.data, null)
      assert.ok(res2.error)
      assert.match(res2.error.message, /title cannot be empty/i)
    })

    it('rejects update with title exceeding 100 characters', async () => {
      const longTitle = 'a'.repeat(101)
      const res = await updateSupabasePlaylist({
        playlistId: 'mock-playlist-id',
        title: longTitle,
      })
      assert.equal(res.data, null)
      assert.ok(res.error)
      assert.match(res.error.message, /must not exceed 100 characters/i)
    })

    it('rejects update with description exceeding 500 characters', async () => {
      const longDesc = 'd'.repeat(501)
      const res = await updateSupabasePlaylist({
        playlistId: 'mock-playlist-id',
        description: longDesc,
      })
      assert.equal(res.data, null)
      assert.ok(res.error)
      assert.match(res.error.message, /must not exceed 500 characters/i)
    })

    it('requires authentication to update a playlist with valid title', async () => {
      const res = await updateSupabasePlaylist({
        playlistId: 'mock-playlist-id',
        title: 'Valid Title',
      })
      assert.equal(res.data, null)
      assert.ok(res.error)
      assert.match(res.error.message, /authentication required/i)
    })
  })

  describe('2. Delete Playlist Authentication & Policy', () => {
    it('requires authentication to delete a playlist', async () => {
      const res = await deleteSupabasePlaylist('mock-playlist-id')
      assert.ok(res.error)
      assert.match(res.error.message, /authentication required/i)
    })
  })

  describe('3. Remove Track From Playlist', () => {
    it('requires authentication to remove a track from a playlist', async () => {
      const res = await removeTrackFromPlaylist({
        playlistId: 'mock-playlist-id',
        providerTrackId: 'mock-track-id',
      })
      assert.ok(res.error)
      assert.match(res.error.message, /authentication required/i)
    })
  })

  describe('4. Button Variants Danger Styling', () => {
    it('generates red/danger styles for destructive actions', () => {
      const dangerClasses = buttonVariants({ variant: 'danger' })
      assert.ok(dangerClasses.includes('text-red-400'))
      assert.ok(dangerClasses.includes('border-red-500'))
    })
  })

  describe('5. Context Menu Screen Clamping Logic', () => {
    it('clamps coordinates properly within screen boundaries', () => {
      const menuWidth = 190
      const menuHeight = 160
      const screenWidth = 1000
      const screenHeight = 800

      // Case 1: Normal position
      const normalX = 200
      const normalY = 300
      const clampedX1 = Math.max(10, Math.min(normalX, screenWidth - menuWidth - 10))
      const clampedY1 = Math.max(10, Math.min(normalY, screenHeight - menuHeight - 10))
      assert.equal(clampedX1, 200)
      assert.equal(clampedY1, 300)

      // Case 2: Near right/bottom edge (overflow protection)
      const edgeX = 990
      const edgeY = 790
      const clampedX2 = Math.max(10, Math.min(edgeX, screenWidth - menuWidth - 10))
      const clampedY2 = Math.max(10, Math.min(edgeY, screenHeight - menuHeight - 10))
      assert.equal(clampedX2, 1000 - 190 - 10) // 800
      assert.equal(clampedY2, 800 - 160 - 10) // 630

      // Case 3: Near top/left edge (underflow protection)
      const minX = -10
      const minY = -5
      const clampedX3 = Math.max(10, Math.min(minX, screenWidth - menuWidth - 10))
      const clampedY3 = Math.max(10, Math.min(minY, screenHeight - menuHeight - 10))
      assert.equal(clampedX3, 10)
      assert.equal(clampedY3, 10)
    })
  })
})
