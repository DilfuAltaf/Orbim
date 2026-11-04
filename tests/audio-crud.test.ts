import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  validateCatalogAudioFile,
} from '../src/services/catalog/global-catalog-service.ts'
import {
  cacheGlobalAudioRecord,
  deleteCachedAudioRecord,
  getCachedAudioRecord,
  resolveEffectiveTrack,
} from '../src/services/audio/global-audio-registry.ts'
import {
  loadServerAudioRegistry,
  saveServerAudioRecord,
} from '../src/server/audio-registry-service.ts'
import type { MusicTrack } from '../src/types/music.ts'

describe('Audio Validation & Audio Registry Service', () => {
  describe('1. Audio File Validation', () => {
    it('accepts valid audio files (mp3, wav, flac, ogg, m4a, aac)', () => {
      const mockMp3 = new Blob(['a'.repeat(2000)], { type: 'audio/mpeg' })
      const res = validateCatalogAudioFile(mockMp3, 'song.mp3')
      assert.equal(res.valid, true)
      assert.equal(res.extension, '.mp3')
      assert.equal(res.mimeType, 'audio/mpeg')
    })

    it('rejects unsupported extensions', () => {
      const mockExe = new Blob(['a'.repeat(2000)], { type: 'application/octet-stream' })
      const res = validateCatalogAudioFile(mockExe, 'virus.exe')
      assert.equal(res.valid, false)
      assert.match(res.error || '', /tidak didukung|unsupported/i)
    })

    it('rejects files smaller than minimum threshold (1024 bytes)', () => {
      const tiny = new Blob(['tiny'], { type: 'audio/mpeg' })
      const res = validateCatalogAudioFile(tiny, 'short.mp3')
      assert.equal(res.valid, false)
      assert.match(res.error || '', /terlalu kecil|too small/i)
    })
  })

  describe('2. Audio Registry Cache & Resolution Lifecycle', () => {
    const testTrackId = 'spotify-test-track-crud-99'

    it('caches global audio and resolves track as playable', () => {
      cacheGlobalAudioRecord({
        providerTrackId: testTrackId,
        storagePath: 'test/path.mp3',
        audioUrl: 'https://cdn.orbim.app/test/path.mp3',
        audioSourceType: 'storage',
        title: 'Test Song',
        artistName: 'Test Artist',
        updatedAt: new Date().toISOString(),
      })

      const cached = getCachedAudioRecord(testTrackId)
      assert.ok(cached)
      assert.equal(cached.audioUrl, 'https://cdn.orbim.app/test/path.mp3')

      const rawTrack: MusicTrack = {
        id: testTrackId,
        provider: 'spotify',
        providerTrackId: testTrackId,
        title: 'Test Song',
        artistName: 'Test Artist',
        durationSeconds: 200,
        genre: 'Pop',
        moods: [],
        isPlayable: false,
      }

      const effective = resolveEffectiveTrack(rawTrack)
      assert.equal(effective?.isPlayable, true)
      assert.equal(effective?.playbackUrl, 'https://cdn.orbim.app/test/path.mp3')
    })

    it('clears audio record for spotify:track: URI prefix variants as well', () => {
      const prefixedId = 'spotify:track:4cOdK2wGLETKBW3PvgPWqT'
      const rawId = '4cOdK2wGLETKBW3PvgPWqT'

      cacheGlobalAudioRecord({
        providerTrackId: rawId,
        storagePath: 'test/path.mp3',
        audioUrl: 'https://cdn.orbim.app/test/path.mp3',
        audioSourceType: 'storage',
        updatedAt: new Date().toISOString(),
      })

      assert.ok(getCachedAudioRecord(prefixedId))
      assert.ok(getCachedAudioRecord(rawId))

      deleteCachedAudioRecord(prefixedId)

      assert.equal(getCachedAudioRecord(prefixedId), null)
      assert.equal(getCachedAudioRecord(rawId), null)
    })
  })

  describe('3. Server-Side Audio Registry', () => {
    const serverTrackId = 'server-test-track-888'

    it('saves audio record in server registry and persists metadata', () => {
      saveServerAudioRecord({
        providerTrackId: serverTrackId,
        audioUrl: '/assets/audio/test.mp3',
        audioSourceType: 'direct_stream',
        title: 'Server Song',
        artistName: 'Server Artist',
        updatedAt: new Date().toISOString(),
      })

      const registry = loadServerAudioRegistry()
      assert.ok(registry[serverTrackId])
      assert.equal(registry[serverTrackId].title, 'Server Song')
      assert.equal(registry[serverTrackId].audioUrl, '/assets/audio/test.mp3')
    })
  })
})
