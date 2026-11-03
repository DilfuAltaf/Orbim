import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://mock-test.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'mock-anon-key'

const {
  cacheGlobalAudioRecord,
  getCachedAudioRecord,
  getAllCachedAudioRecords,
  normalizeTrackId,
  enrichTracksWithGlobalAudio,
} = await import('../src/services/audio/global-audio-registry.ts')
const { isUserAdmin } = await import('../src/features/auth/admin.ts')
import type { MusicTrack } from '../src/types/music.ts'

describe('Explore Audio Status & Playability State', () => {
  const sampleTrack: MusicTrack = {
    provider: 'spotify',
    providerTrackId: '4cOdK2wGLETKBW3PvgPWqT',
    title: 'Never Gonna Give You Up',
    artistName: 'Rick Astley',
    durationSeconds: 213,
    genre: 'Spotify',
    moods: [],
    isPlayable: false,
  }

  it('normalizes Spotify URIs and raw IDs symmetrically', () => {
    assert.equal(normalizeTrackId('spotify:track:4cOdK2wGLETKBW3PvgPWqT'), '4cOdK2wGLETKBW3PvgPWqT')
    assert.equal(normalizeTrackId('4cOdK2wGLETKBW3PvgPWqT'), '4cOdK2wGLETKBW3PvgPWqT')
    assert.equal(normalizeTrackId(''), '')
  })

  it('keeps track unplayable with "No audio" status when no audio uploaded', async () => {
    const unplayableTrack: MusicTrack = {
      ...sampleTrack,
      providerTrackId: 'unattached_track_9999',
    }

    const [result] = await enrichTracksWithGlobalAudio([unplayableTrack])
    assert.equal(result.isPlayable, false)
    assert.equal(result.playbackUrl, undefined)
  })

  it('transitions track to playable with "Audio ready" when audio is cached/propagated', async () => {
    const trackId = 'test_track_with_audio_123'
    const audioUrl = 'https://mock-test.supabase.co/storage/v1/object/public/track-audio/rick.mp3'

    cacheGlobalAudioRecord({
      providerTrackId: trackId,
      storagePath: 'track-audio/rick.mp3',
      audioUrl,
      audioSourceType: 'storage',
      title: 'Never Gonna Give You Up',
      artistName: 'Rick Astley',
      updatedAt: new Date().toISOString(),
    })

    const cached = getCachedAudioRecord(trackId)
    assert.ok(cached)
    assert.equal(cached.audioUrl, audioUrl)

    const rawTrack: MusicTrack = {
      ...sampleTrack,
      providerTrackId: trackId,
      isPlayable: false,
    }

    const [enriched] = await enrichTracksWithGlobalAudio([rawTrack])
    assert.equal(enriched.isPlayable, true)
    assert.equal(enriched.playbackUrl, audioUrl)
    assert.equal(enriched.audioSourceType, 'storage')
  })

  it('resolves audio when providerTrackId is passed with spotify:track: prefix', async () => {
    const trackId = 'test_prefix_match_456'
    const audioUrl = 'https://mock-test.supabase.co/storage/v1/object/public/track-audio/song.mp3'

    cacheGlobalAudioRecord({
      providerTrackId: trackId,
      storagePath: 'track-audio/song.mp3',
      audioUrl,
      audioSourceType: 'storage',
      updatedAt: new Date().toISOString(),
    })

    const prefixedTrack: MusicTrack = {
      ...sampleTrack,
      providerTrackId: `spotify:track:${trackId}`,
      isPlayable: false,
    }

    const [enriched] = await enrichTracksWithGlobalAudio([prefixedTrack])
    assert.equal(enriched.isPlayable, true)
    assert.equal(enriched.playbackUrl, audioUrl)
  })

  it('preserves existing playable tracks directly', async () => {
    const alreadyPlayable: MusicTrack = {
      ...sampleTrack,
      isPlayable: true,
      playbackUrl: 'https://example.com/stream.mp3',
    }

    const [enriched] = await enrichTracksWithGlobalAudio([alreadyPlayable])
    assert.equal(enriched.isPlayable, true)
    assert.equal(enriched.playbackUrl, 'https://example.com/stream.mp3')
  })

  it('retrieves dictionary of all cached audio records for remote syncing', () => {
    const all = getAllCachedAudioRecords()
    assert.ok(typeof all === 'object')
    assert.ok(Object.keys(all).length > 0)
  })

  it('strictly restricts track adding and audio uploading to admin account', () => {
    assert.equal(isUserAdmin('dilfualtaf07@gmail.com'), true)
    assert.equal(isUserAdmin('DILFUALTAF07@GMAIL.COM'), true)
    assert.equal(isUserAdmin('user1@example.com'), false)
    assert.equal(isUserAdmin('someone_else@gmail.com'), false)
    assert.equal(isUserAdmin(null), false)
  })
})
