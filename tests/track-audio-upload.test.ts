import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isUserAdmin } from '../src/features/auth/admin.ts'
import { validateUploadAudioFile, attachAudioToTrack } from '../src/services/audio/track-audio-upload.ts'
import { MAX_AUDIO_FILE_SIZE_BYTES } from '../src/services/audio/audio-storage.ts'

describe('Admin Authority & Platform Permissions', () => {
  it('strictly designates dilfualtaf07@gmail.com and orbim@admin.com as platform admins', () => {
    assert.equal(isUserAdmin('dilfualtaf07@gmail.com'), true)
    assert.equal(isUserAdmin('DILFUALTAF07@GMAIL.COM'), true)
    assert.equal(isUserAdmin('  dilfualtaf07@gmail.com  '), true)
    assert.equal(isUserAdmin('orbim@admin.com'), true)
    assert.equal(isUserAdmin('ORBIM@ADMIN.COM'), true)
  })

  it('rejects non-admin emails and guest/null sessions', () => {
    assert.equal(isUserAdmin('otheruser@example.com'), false)
    assert.equal(isUserAdmin('hacker@domain.com'), false)
    assert.equal(isUserAdmin(''), false)
    assert.equal(isUserAdmin(null), false)
    assert.equal(isUserAdmin(undefined), false)
  })
})

describe('Track Audio Upload & File Validation', () => {
  it('validates supported audio file types (.mp3, .wav, .flac, .ogg, .m4a)', () => {
    const validMp3 = new Blob(['x'.repeat(1000)], { type: 'audio/mpeg' })
    const res1 = validateUploadAudioFile(validMp3, 'song.mp3')
    assert.equal(res1.valid, true)
    assert.equal(res1.extension, '.mp3')
    assert.equal(res1.mimeType, 'audio/mpeg')

    const validWav = new Blob(['x'.repeat(1000)], { type: 'audio/wav' })
    const res2 = validateUploadAudioFile(validWav, 'track.wav')
    assert.equal(res2.valid, true)
    assert.equal(res2.extension, '.wav')
    assert.equal(res2.mimeType, 'audio/wav')

    const validFlac = new Blob(['x'.repeat(1000)], { type: 'audio/flac' })
    const res3 = validateUploadAudioFile(validFlac, 'highres.flac')
    assert.equal(res3.valid, true)
    assert.equal(res3.extension, '.flac')
    assert.equal(res3.mimeType, 'audio/flac')
  })

  it('rejects unsupported file formats (.exe, .txt, .pdf, .mp4)', () => {
    const textBlob = new Blob(['not audio content'], { type: 'text/plain' })
    const res1 = validateUploadAudioFile(textBlob, 'document.txt')
    assert.equal(res1.valid, false)
    assert.match(res1.error || '', /format/i)

    const exeBlob = new Blob(['executable binary'], { type: 'application/octet-stream' })
    const res2 = validateUploadAudioFile(exeBlob, 'malicious.exe')
    assert.equal(res2.valid, false)
  })

  it('rejects files exceeding maximum size limit (50 MB)', () => {
    // Fake a large file via object with size property
    const oversized = { size: MAX_AUDIO_FILE_SIZE_BYTES + 100 } as unknown as Blob
    const res = validateUploadAudioFile(oversized, 'huge_song.mp3')
    assert.equal(res.valid, false)
    assert.match(res.error || '', /50/i)
  })

  it('rejects empty or corrupt files (<100 bytes)', () => {
    const tinyBlob = new Blob(['too small'], { type: 'audio/mpeg' }) // 9 bytes
    const res = validateUploadAudioFile(tinyBlob, 'broken.mp3')
    assert.equal(res.valid, false)
    assert.match(res.error || '', /terlalu kecil|too small|minimum/i)
  })

  it('attachAudioToTrack rejects invalid audio files before attempting upload', async () => {
    const invalidBlob = new Blob(['invalid text content'], { type: 'text/plain' })
    const res = await attachAudioToTrack({
      playlistId: 'test-playlist-id',
      trackId: 'test-track-id',
      audioFile: invalidBlob,
      fileName: 'invalid.txt',
    })
    assert.equal(res.success, false)
    assert.match(res.error?.message || '', /format/i)
  })
})

describe('Global Audio Registry & Cross-User Audio Sharing', () => {
  it('normalizes Spotify IDs removing URI prefixes for consistent matching', async () => {
    const { normalizeTrackId } = await import('../src/services/audio/global-audio-registry.ts')
    assert.equal(normalizeTrackId('spotify:track:4cOdK2wGLETKBW3PvgPWqT'), '4cOdK2wGLETKBW3PvgPWqT')
    assert.equal(normalizeTrackId('4cOdK2wGLETKBW3PvgPWqT'), '4cOdK2wGLETKBW3PvgPWqT')
    assert.equal(normalizeTrackId('  SPOTIFY:TRACK:xyz123  '), 'xyz123')
  })

  it('caches and retrieves uploaded audio records by providerTrackId', async () => {
    const { cacheGlobalAudioRecord, getCachedAudioRecord } = await import('../src/services/audio/global-audio-registry.ts')
    const sampleRecord = {
      providerTrackId: 'spotify:track:test12345',
      storagePath: 'test-playlist/test-audio.mp3',
      audioUrl: 'https://example.supabase.co/storage/v1/object/public/track-audio/test-audio.mp3',
      audioSourceType: 'storage' as const,
      title: 'Global Hit',
      artistName: 'Famous Artist',
      updatedAt: new Date().toISOString(),
    }

    cacheGlobalAudioRecord(sampleRecord)

    // Lookup with exact ID
    const found1 = getCachedAudioRecord('spotify:track:test12345')
    assert.ok(found1)
    assert.equal(found1.audioUrl, sampleRecord.audioUrl)

    // Lookup with normalized ID without spotify:track: prefix
    const found2 = getCachedAudioRecord('test12345')
    assert.ok(found2)
    assert.equal(found2.audioUrl, sampleRecord.audioUrl)
  })

  it('enrichTracksWithGlobalAudio enriches unplayable tracks with registered admin audio', async () => {
    const { cacheGlobalAudioRecord, enrichTracksWithGlobalAudio } = await import('../src/services/audio/global-audio-registry.ts')
    
    // Register audio for track "shared_song_001"
    cacheGlobalAudioRecord({
      providerTrackId: 'shared_song_001',
      storagePath: 'playlist-abc/audio.mp3',
      audioUrl: 'https://example.supabase.co/audio.mp3',
      audioSourceType: 'storage',
      title: 'Admin Song',
      artistName: 'Admin Artist',
      updatedAt: new Date().toISOString(),
    })

    const initialTracks = [
      {
        provider: 'spotify' as const,
        providerTrackId: 'shared_song_001',
        title: 'Admin Song',
        artistName: 'Admin Artist',
        durationSeconds: 180,
        genre: 'Spotify',
        moods: [],
        isPlayable: false, // Originally unplayable metadata
      },
      {
        provider: 'spotify' as const,
        providerTrackId: 'unuploaded_song_002',
        title: 'Other Song',
        artistName: 'Other Artist',
        durationSeconds: 200,
        genre: 'Spotify',
        moods: [],
        isPlayable: false,
      },
    ]

    const enriched = await enrichTracksWithGlobalAudio(initialTracks)

    // First track received admin audio and became playable for any user
    assert.equal(enriched[0].isPlayable, true)
    assert.equal(enriched[0].playbackUrl, 'https://example.supabase.co/audio.mp3')
    assert.equal(enriched[0].audioSourceType, 'storage')

    // Second track remains unplayable because no audio has been uploaded yet
    assert.equal(enriched[1].isPlayable, false)
    assert.equal(enriched[1].playbackUrl, undefined)
  })
})
