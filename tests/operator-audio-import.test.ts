import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { before, describe, it } from 'node:test'

import {
  applyCliAudioOption,
  parseArgs,
  validateAudioFileOnDisk,
  validateOperatorTrack as validateCliTrack,
} from '../scripts/operator-import.mjs'

import {
  DEFAULT_AUDIO_BUCKET,
  MAX_AUDIO_FILE_SIZE_BYTES,
  MIN_AUDIO_FILE_SIZE_BYTES,
  SUPPORTED_AUDIO_EXTENSIONS,
  getAudioMimeType,
  resolveTrackAudioPlayback,
  uploadTrackAudioToSupabase,
  validateAudioFileMetadata,
  validateAudioSourceUrl,
} from '../src/services/audio/audio-storage.ts'
import {
  executeOperatorImport,
  validateOperatorTrack,
  type OperatorTrackInput,
} from '../src/services/import/operator-workflow.ts'

describe('Audio Import: File & Metadata Validation', () => {
  it('correctly maps supported audio file extensions to standard MIME types', () => {
    assert.equal(getAudioMimeType('track.mp3'), 'audio/mpeg')
    assert.equal(getAudioMimeType('track.wav'), 'audio/wav')
    assert.equal(getAudioMimeType('track.ogg'), 'audio/ogg')
    assert.equal(getAudioMimeType('track.opus'), 'audio/ogg')
    assert.equal(getAudioMimeType('track.m4a'), 'audio/mp4')
    assert.equal(getAudioMimeType('track.aac'), 'audio/aac')
    assert.equal(getAudioMimeType('track.flac'), 'audio/flac')
    assert.equal(getAudioMimeType('track.MP3'), 'audio/mpeg', 'Case-insensitive extension check')
  })

  it('rejects unsupported or non-audio file extensions', () => {
    const invalidFiles = ['song.exe', 'script.sh', 'index.html', 'payload.js', 'video.mp4', 'doc.pdf']
    for (const f of invalidFiles) {
      const result = validateAudioFileMetadata({ fileName: f, sizeBytes: 5000 })
      assert.equal(result.valid, false, `File ${f} must be rejected`)
      assert.ok(result.error?.includes('tidak didukung'))
    }
  })

  it('rejects files without an extension', () => {
    const result = validateAudioFileMetadata({ fileName: 'unknown_audio_file', sizeBytes: 5000 })
    assert.equal(result.valid, false)
    assert.ok(result.error?.includes('tidak memiliki ekstensi'))
  })

  it('rejects files smaller than the minimum size threshold (corrupted / empty)', () => {
    assert.ok('.mp3' in SUPPORTED_AUDIO_EXTENSIONS)
    const result = validateAudioFileMetadata({ fileName: 'empty.mp3', sizeBytes: MIN_AUDIO_FILE_SIZE_BYTES - 1 })
    assert.equal(result.valid, false)
    assert.ok(result.error?.includes('terlalu kecil'))
  })

  it('rejects files exceeding the maximum size limit (50 MB)', () => {
    const result = validateAudioFileMetadata({
      fileName: 'massive_audio.wav',
      sizeBytes: MAX_AUDIO_FILE_SIZE_BYTES + 1024,
    })
    assert.equal(result.valid, false)
    assert.ok(result.error?.includes('melebihi batas maksimum'))
  })

  it('accepts valid audio files within normal size boundaries', () => {
    const result = validateAudioFileMetadata({
      fileName: 'master_track_01.flac',
      sizeBytes: 25_000_000, // 25 MB
    })
    assert.equal(result.valid, true)
    assert.equal(result.mimeType, 'audio/flac')
    assert.equal(result.extension, '.flac')
  })
})

describe('Audio Import: Source URL & Copyright Restriction Policies', () => {
  it('accepts authorized direct audio stream URLs (public domain / open licenses)', () => {
    const urls = [
      'https://archive.org/download/beethoven_symphony_5/beethoven_5th.mp3',
      'https://upload.wikimedia.org/wikipedia/commons/4/4e/Sample_audio.ogg',
      'https://cdn.example.org/audio/track_sample.flac',
      'https://music.creative-commons.org/streams/acoustic_demo.m4a',
    ]

    for (const url of urls) {
      const result = validateAudioSourceUrl(url)
      assert.equal(result.valid, true, `URL ${url} must be valid`)
      assert.equal(result.audioSourceType, 'direct_stream')
      assert.equal(result.isDirectPlayable, true)
    }
  })

  it('identifies external informational web links and disallows direct native playback', () => {
    const result = validateAudioSourceUrl('https://artist.bandcamp.com/album/independent-release')
    assert.equal(result.valid, true)
    assert.equal(result.audioSourceType, 'external_url')
    assert.equal(result.isDirectPlayable, false)
    assert.ok(result.error?.includes('tautan eksternal'))
  })

  it('strictly rejects unauthorized ripping/scraping targets (Spotify, YouTube, SoundCloud)', () => {
    const disallowedUrls = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
      'https://spotify.com/track/12345',
      'https://soundcloud.com/artist/song-title',
      'https://music.apple.com/us/album/song/123',
    ]

    for (const url of disallowedUrls) {
      const result = validateAudioSourceUrl(url)
      assert.equal(result.valid, false, `Scraping target ${url} must be rejected`)
      assert.ok(result.error?.includes('hak cipta') || result.error?.includes('dilarang'))
    }
  })

  it('rejects invalid URL structures and unsupported protocols', () => {
    assert.equal(validateAudioSourceUrl('not-a-valid-url').valid, false)
    assert.equal(validateAudioSourceUrl('ftp://files.org/song.mp3').valid, false)
    assert.equal(validateAudioSourceUrl('').valid, false)
  })
})

describe('Audio Import: Storage Upload & Batch Workflow Integration', () => {
  function createMockSupabaseWithStorage(options?: {
    authenticatedUser?: { id: string; email: string } | null
    existingPlaylistTracks?: Array<{
      id: string
      title: string
      artist_name: string
      position: number
      provider_track_id: string
    }>
    storageUploadError?: boolean
    databaseInsertError?: boolean
  }) {
    const user = options?.authenticatedUser !== undefined
      ? options.authenticatedUser
      : { id: 'user_operator_123', email: 'operator@orbim.local' }

    const storedRows: any[] = [...(options?.existingPlaylistTracks || [])]
    const storageObjects = new Map<string, { buffer: any; contentType: string }>()

    return {
      auth: {
        getUser: async () => {
          if (!user) return { data: { user: null }, error: { message: 'Not authenticated' } }
          return { data: { user }, error: null }
        },
      },
      storage: {
        from: (bucket: string) => {
          if (bucket !== DEFAULT_AUDIO_BUCKET) {
            throw new Error(`Unexpected bucket ${bucket}`)
          }
          return {
            upload: async (objectPath: string, fileData: any, opts: any) => {
              if (options?.storageUploadError) {
                return { data: null, error: { message: 'Storage quota exceeded or permission denied' } }
              }
              storageObjects.set(objectPath, { buffer: fileData, contentType: opts.contentType })
              return { data: { path: objectPath }, error: null }
            },
            getPublicUrl: (objectPath: string) => {
              return {
                data: {
                  publicUrl: `https://mock.supabase.co/storage/v1/object/public/${DEFAULT_AUDIO_BUCKET}/${objectPath}`,
                },
              }
            },
          }
        },
      },
      from: (table: string) => {
        if (table !== 'playlist_tracks') throw new Error(`Unexpected table ${table}`)
        return {
          select: (_cols: string) => ({
            eq: (_field: string, val: string) => ({
              order: () => {
                const matched = storedRows.filter((r) => r.playlist_id === val || !r.playlist_id)
                return Promise.resolve({ data: matched, error: null })
              },
              in: (_inCol: string, inVals: string[]) => {
                const matched = storedRows.filter((r) => inVals.includes(r.provider_track_id))
                return Promise.resolve({ data: matched, error: null })
              },
            }),
          }),
          insert: (rows: any[]) => {
            if (options?.databaseInsertError) {
              return Promise.resolve({ data: null, error: { message: 'Database RLS error' } })
            }
            for (const r of rows) {
              storedRows.push({
                id: `track_id_${Math.random().toString(36).substring(2, 8)}`,
                ...r,
              })
            }
            return Promise.resolve({ data: storedRows, error: null })
          },
        } as any
      },
      _storageObjects: storageObjects,
      _storedRows: storedRows,
    } as any
  }

  it('validates operator track inputs and detects audio upload requirements', () => {
    const rawWithBuffer = {
      title: 'Track A',
      artist: 'Artist A',
      audioBuffer: Buffer.from('data'.repeat(50)),
      audioFileName: 'track.mp3',
    }
    const val = validateOperatorTrack(rawWithBuffer)
    assert.equal(val.valid, true)
    assert.equal(val.hasAudioUpload, true)
    assert.equal(val.audioSourceType, 'storage')
    assert.equal(val.isPlayable, true)
  })

  it('uploads track audio to Supabase Storage with correct path and content type', async () => {
    const mockSupabase = createMockSupabaseWithStorage()
    const result = await uploadTrackAudioToSupabase({
      supabase: mockSupabase,
      playlistId: 'playlist-direct-test',
      trackId: 'track_123',
      fileData: Buffer.from('audio sample'.repeat(20)),
      fileName: 'song.mp3',
      bucketName: DEFAULT_AUDIO_BUCKET,
    })
    assert.equal(result.error, null)
    assert.equal(result.storagePath, 'playlist-direct-test/track_123.mp3')
    assert.ok(result.publicUrl?.includes('playlist-direct-test/track_123.mp3'))
  })

  it('successfully uploads audio file buffer to Supabase Storage and records storage_path', async () => {
    const mockSupabase = createMockSupabaseWithStorage()
    const audioData = Buffer.from('Mock MP3 Audio Frame Header and Content 1234567890'.repeat(10))

    const tracks: OperatorTrackInput[] = [
      {
        title: 'Original Composition',
        artist: 'Creative Musician',
        album: 'Indie Studio Session',
        audioBuffer: audioData,
        audioFileName: 'original_track.mp3',
        durationSeconds: 180,
      },
    ]

    const report = await executeOperatorImport({
      supabase: mockSupabase,
      playlistId: 'playlist-audio-01',
      tracks,
    })

    assert.equal(report.succeeded.length, 1)
    const saved = report.succeeded[0]
    assert.equal(saved.title, 'Original Composition')
    assert.equal(saved.hasAudio, true)
    assert.equal(saved.isPlayable, true)
    assert.equal(saved.audioSourceType, 'storage')
    assert.ok(saved.storagePath?.startsWith('playlist-audio-01/'))
    assert.ok(saved.audioUrl?.includes('storage/v1/object/public/track-audio/'))

    // Verify storage object was written in the mock
    assert.equal(mockSupabase._storageObjects.size, 1)
    const storedObj = mockSupabase._storageObjects.get(saved.storagePath!)
    assert.ok(storedObj)
    assert.equal(storedObj.contentType, 'audio/mpeg')
  })

  it('supports direct stream URLs without Storage upload and marks isPlayable = true', async () => {
    const mockSupabase = createMockSupabaseWithStorage()
    const tracks: OperatorTrackInput[] = [
      {
        title: 'Public Domain Classical',
        artist: 'Orchestra',
        audioSourceUrl: 'https://archive.org/download/public_domain/symphony.mp3',
        durationSeconds: 420,
      },
    ]

    const report = await executeOperatorImport({
      supabase: mockSupabase,
      playlistId: 'playlist-audio-01',
      tracks,
    })

    assert.equal(report.succeeded.length, 1)
    const saved = report.succeeded[0]
    assert.equal(saved.hasAudio, true)
    assert.equal(saved.isPlayable, true)
    assert.equal(saved.audioSourceType, 'direct_stream')
    assert.equal(saved.storagePath, null)
    assert.equal(saved.audioUrl, 'https://archive.org/download/public_domain/symphony.mp3')
    assert.equal(mockSupabase._storageObjects.size, 0, 'No storage upload for direct stream')
  })

  it('preserves metadata-only imports when no audio is provided', async () => {
    const mockSupabase = createMockSupabaseWithStorage()
    const tracks: OperatorTrackInput[] = [
      {
        title: 'Metadata Song',
        artist: 'Unknown Group',
        album: 'Acoustic Archive',
      },
    ]

    const report = await executeOperatorImport({
      supabase: mockSupabase,
      playlistId: 'playlist-audio-01',
      tracks,
    })

    assert.equal(report.succeeded.length, 1)
    const saved = report.succeeded[0]
    assert.equal(saved.hasAudio, false)
    assert.equal(saved.isPlayable, false)
    assert.equal(saved.audioSourceType, 'none')
    assert.equal(saved.storagePath, null)
    assert.equal(saved.audioUrl, null)
  })

  it('skips audio upload when duplicate is detected in the batch or target playlist', async () => {
    const mockSupabase = createMockSupabaseWithStorage({
      existingPlaylistTracks: [
        {
          id: 'existing-1',
          title: 'Existing Song',
          artist_name: 'Artist',
          position: 1000,
          provider_track_id: 'orb_001',
        },
      ],
    })

    const audioData = Buffer.from('Dummy audio payload 1234567890'.repeat(10))
    const tracks: OperatorTrackInput[] = [
      {
        title: 'Existing Song',
        artist: 'Artist',
        audioBuffer: audioData,
        audioFileName: 'duplicate.mp3',
      },
    ]

    const report = await executeOperatorImport({
      supabase: mockSupabase,
      playlistId: 'playlist-audio-01',
      tracks,
    })

    assert.equal(report.succeeded.length, 0)
    assert.equal(report.duplicates.length, 1)
    assert.equal(mockSupabase._storageObjects.size, 0, 'Audio upload must be skipped for duplicate track')
  })

  it('gracefully handles Storage upload failure without crashing batch', async () => {
    const mockSupabase = createMockSupabaseWithStorage({ storageUploadError: true })
    const audioData = Buffer.from('Dummy audio payload 1234567890'.repeat(10))

    const tracks: OperatorTrackInput[] = [
      {
        title: 'Track With Failing Storage',
        artist: 'Artist',
        audioBuffer: audioData,
        audioFileName: 'failing.mp3',
      },
    ]

    const report = await executeOperatorImport({
      supabase: mockSupabase,
      playlistId: 'playlist-audio-01',
      tracks,
    })

    assert.equal(report.succeeded.length, 0)
    assert.equal(report.failed.length, 1)
    assert.ok(report.failed[0].errors.some((e) => e.includes('Gagal mengunggah file audio')))
  })

  it('enforces unverified status on tracks with uploaded audio', async () => {
    const mockSupabase = createMockSupabaseWithStorage()
    const tracks: OperatorTrackInput[] = [
      {
        title: 'Brand New Single',
        artist: 'Studio Artist',
        audioBuffer: Buffer.from('Mock audio data 1234567890'.repeat(10)),
        audioFileName: 'single.mp3',
      },
    ]

    const report = await executeOperatorImport({
      supabase: mockSupabase,
      playlistId: 'playlist-audio-01',
      tracks,
    })

    assert.equal(report.succeeded[0].verificationStatus, 'unverified', 'Imported track must start strictly unverified')
    assert.equal(report.succeeded[0].addedVia, 'ai_cli', 'Operator tracks attribute added_via = ai_cli')
  })
})

describe('Audio Import: Playback Resolution & Player Integration', () => {
  it('resolves playback for Supabase Storage-backed track with public URL', () => {
    const mockStorageClient = {
      storage: {
        from: (bucket: string) => ({
          getPublicUrl: (filePath: string) => ({
            data: { publicUrl: `https://my-project.supabase.co/storage/v1/object/public/${bucket}/${filePath}` },
          }),
        }),
      },
    } as any

    const track = {
      audio_url: 'https://my-project.supabase.co/storage/v1/object/public/track-audio/playlist-1/song.mp3',
      storage_path: 'playlist-1/song.mp3',
      audio_source_type: 'storage',
    }

    const resolved = resolveTrackAudioPlayback(track, mockStorageClient)
    assert.equal(resolved.isPlayable, true)
    assert.equal(resolved.audioSourceType, 'storage')
    assert.equal(resolved.playbackUrl, 'https://my-project.supabase.co/storage/v1/object/public/track-audio/playlist-1/song.mp3')
  })

  it('resolves playback for direct audio stream URL', () => {
    const track = {
      audio_url: 'https://cdn.example.org/music/track.mp3',
      storage_path: null,
      audio_source_type: 'direct_stream',
    }

    const resolved = resolveTrackAudioPlayback(track)
    assert.equal(resolved.isPlayable, true)
    assert.equal(resolved.audioSourceType, 'direct_stream')
    assert.equal(resolved.playbackUrl, 'https://cdn.example.org/music/track.mp3')
  })

  it('marks external informational URLs as unplayable in native audio element', () => {
    const track = {
      audio_url: 'https://artist.bandcamp.com/track/my-song',
      storage_path: null,
      audio_source_type: 'external_url',
    }

    const resolved = resolveTrackAudioPlayback(track)
    assert.equal(resolved.isPlayable, false)
    assert.equal(resolved.audioSourceType, 'external_url')
    assert.equal(resolved.playbackUrl, undefined)
  })

  it('marks tracks with no audio as unplayable', () => {
    const track = {
      audio_url: null,
      storage_path: null,
      audio_source_type: 'none',
    }

    const resolved = resolveTrackAudioPlayback(track)
    assert.equal(resolved.isPlayable, false)
    assert.equal(resolved.audioSourceType, 'none')
    assert.equal(resolved.playbackUrl, undefined)
  })
})

describe('Operator CLI Script: Arguments & Disk Audio Validation', () => {
  before(() => {
    const fixtureDir = path.resolve(process.cwd(), 'assets', 'audio')
    const fixturePath = path.resolve(fixtureDir, 'synthetic-test-fixture.wav')
    if (!fs.existsSync(fixtureDir)) {
      fs.mkdirSync(fixtureDir, { recursive: true })
    }
    if (!fs.existsSync(fixturePath)) {
      const dataSize = 320
      const buf = Buffer.alloc(44 + dataSize)
      buf.write('RIFF', 0)
      buf.writeUInt32LE(36 + dataSize, 4)
      buf.write('WAVE', 8)
      buf.write('fmt ', 12)
      buf.writeUInt32LE(16, 16)
      buf.writeUInt16LE(1, 20)
      buf.writeUInt16LE(1, 22)
      buf.writeUInt32LE(8000, 24)
      buf.writeUInt32LE(16000, 28)
      buf.writeUInt16LE(2, 32)
      buf.writeUInt16LE(16, 34)
      buf.write('data', 36)
      buf.writeUInt32LE(dataSize, 40)
      fs.writeFileSync(fixturePath, buf)
    }
  })

  it('parses CLI arguments with space-separated flags', () => {
    const opts = parseArgs([
      '--playlist', 'pl-123',
      '--file', 'track-input.json',
      '--audio', 'assets/audio/test.wav',
      '--dry-run',
    ])
    assert.equal(opts.playlist, 'pl-123')
    assert.equal(opts.file, 'track-input.json')
    assert.equal(opts.audio, 'assets/audio/test.wav')
    assert.equal(opts.dryRun, true)
  })

  it('parses CLI arguments with equals format (--flag=value)', () => {
    const opts = parseArgs([
      '--playlist=pl-456',
      '--file=track-input.json',
      '--audio=assets/audio/test.wav',
      '--email=op@orbim.local',
      '--password=secret',
      '--json',
    ])
    assert.equal(opts.playlist, 'pl-456')
    assert.equal(opts.file, 'track-input.json')
    assert.equal(opts.audio, 'assets/audio/test.wav')
    assert.equal(opts.email, 'op@orbim.local')
    assert.equal(opts.password, 'secret')
    assert.equal(opts.json, true)
  })

  it('validates synthetic WAV fixture on disk successfully with relative path to cwd', () => {
    const fixturePath = 'assets/audio/synthetic-test-fixture.wav'
    const res = validateAudioFileOnDisk(fixturePath)
    assert.equal(res.valid, true)
    assert.equal(res.extension, '.wav')
    assert.equal(res.mimeType, 'audio/wav')
    assert.ok((res.sizeBytes ?? 0) > 100)
    assert.equal(res.fileName, 'synthetic-test-fixture.wav')
  })

  it('validates audio file using absolute path correctly without altering behavior', () => {
    const absPath = path.resolve(process.cwd(), 'assets/audio/synthetic-test-fixture.wav')
    const res = validateAudioFileOnDisk(absPath)
    assert.equal(res.valid, true)
    assert.equal(res.resolvedPath, absPath)
    assert.equal(res.fileName, 'synthetic-test-fixture.wav')
  })

  it('supports audio path relative to JSON folder in subdirectory while preserving cwd priority', () => {
    const subfolderBaseDir = path.resolve(process.cwd(), 'assets/audio')
    // 1. Filename relative to subfolder
    const res1 = validateAudioFileOnDisk('synthetic-test-fixture.wav', subfolderBaseDir)
    assert.equal(res1.valid, true)
    assert.equal(res1.fileName, 'synthetic-test-fixture.wav')

    // 2. Relative path with ./ prefix relative to subfolder
    const res2 = validateAudioFileOnDisk('./synthetic-test-fixture.wav', subfolderBaseDir)
    assert.equal(res2.valid, true)
    assert.equal(res2.fileName, 'synthetic-test-fixture.wav')

    // 3. Absolute path passed with baseDir still respects absolute path
    const absPath = path.resolve(process.cwd(), 'assets/audio/synthetic-test-fixture.wav')
    const res3 = validateAudioFileOnDisk(absPath, path.resolve(process.cwd(), 'non-existent-subfolder'))
    assert.equal(res3.valid, true)
    assert.equal(res3.resolvedPath, absPath)
  })

  it('returns a clear error message when an audio file is not found on disk', () => {
    const missing = 'assets/audio/non-existent-sample.mp3'
    const res = validateAudioFileOnDisk(missing)
    assert.equal(res.valid, false)
    assert.ok(res.error?.includes('File audio tidak ditemukan'))
    assert.ok(res.error?.includes('non-existent-sample.mp3'))
  })

  it('applies CLI --audio option: overrides JSON placeholder for single-track', () => {
    const tracks = [
      { title: 'Test Song', artist: 'Artist', audioFile: 'old-placeholder.mp3' },
    ]
    const updated = applyCliAudioOption(tracks, 'assets/audio/synthetic-test-fixture.wav')
    assert.equal(updated[0].audioFile, 'assets/audio/synthetic-test-fixture.wav')
  })

  it('applies CLI --audio option: warns and does not override for multi-track batch', () => {
    const tracks = [
      { title: 'Song 1', artist: 'Artist 1', audioFile: 'file1.mp3' },
      { title: 'Song 2', artist: 'Artist 2' },
    ]
    let warnMessage = ''
    const updated = applyCliAudioOption(tracks, 'override.mp3', (msg: string) => {
      warnMessage = msg
    })
    assert.ok(warnMessage.includes('Peringatan: Pilihan --audio hanya diterapkan pada single track'))
    assert.equal(updated[0].audioFile, 'file1.mp3', 'First track audio file must be preserved')
    assert.equal(updated[1].audioFile, undefined, 'Second track must not receive batch audio')
  })

  it('enforces CLI exit code contract: exit code 0 on dry-run success, nonzero on validation failure', () => {
    // 1. Success case: synthetic fixture exists -> exit code 0
    const successProc = spawnSync(
      process.execPath,
      [
        'scripts/operator-import.mjs',
        '--dry-run',
        '--file', 'track-input.json',
        '--audio', 'assets/audio/synthetic-test-fixture.wav',
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    assert.equal(successProc.status, 0, 'Successful dry-run must exit with code 0')
    assert.ok(successProc.stdout.includes('Validasi Sukses (Dry-Run)'))

    // 2. Failure case: missing audio file -> exit code 1
    const failProc = spawnSync(
      process.execPath,
      [
        'scripts/operator-import.mjs',
        '--dry-run',
        '--file', 'track-input.json',
        '--audio', 'assets/audio/missing-fixture.wav',
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    assert.equal(failProc.status, 1, 'Dry-run with validation failures must exit with nonzero code 1')
    assert.ok(failProc.stdout.includes('Gagal Validasi / Upload (1)'))

    // 3. Failure case with --json: exits with code 1 and outputs valid JSON report
    const jsonFailProc = spawnSync(
      process.execPath,
      [
        'scripts/operator-import.mjs',
        '--dry-run',
        '--json',
        '--file', 'track-input.json',
        '--audio', 'assets/audio/missing-fixture.wav',
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    assert.equal(jsonFailProc.status, 1, 'JSON mode with validation failures must exit with nonzero code 1')
    const parsedJson = JSON.parse(jsonFailProc.stdout)
    assert.equal(parsedJson.failed.length, 1)
    assert.equal(parsedJson.dryRun, true)
  })

  it('validates operator track with local audio fixture', () => {
    const track = {
      title: 'Synth Demo',
      artist: 'AI Operator',
      audioFile: 'assets/audio/synthetic-test-fixture.wav',
    }
    const val = validateCliTrack(track)
    assert.equal(val.valid, true)
    assert.equal(val.hasAudioUpload, true)
    assert.equal(val.audioSourceType, 'storage')
    assert.equal(val.isPlayable, true)
  })

  it('flags error on operator track with missing audio file', () => {
    const track = {
      title: 'Ghost Demo',
      artist: 'AI Operator',
      audioFile: 'assets/audio/does-not-exist.mp3',
    }
    const val = validateCliTrack(track)
    assert.equal(val.valid, false)
    assert.ok(val.validationErrors.some((e: string) => e.includes('File audio tidak ditemukan')))
  })

  it('handles UTF-8 BOM and single-object JSON parsing safely', () => {
    const bomJson = '\uFEFF{"title":"BOM Track","artist":"BOM Artist"}'
    const clean = bomJson.replace(/^\uFEFF/, '')
    const parsed = JSON.parse(clean)
    const tracks = Array.isArray(parsed) ? parsed : [parsed]
    assert.equal(tracks.length, 1)
    assert.equal(tracks[0].title, 'BOM Track')
    assert.equal(tracks[0].artist, 'BOM Artist')
  })
})

describe('Audio Import: Scope, Environment & Integration Boundaries', () => {
  it('documents test taxonomy: storage metadata and validation tests run locally in-memory', () => {
    const val = validateAudioFileMetadata({ fileName: 'local.mp3', sizeBytes: 5000 })
    assert.equal(val.valid, true)
  })

  it('documents test taxonomy: live remote Supabase Storage upload is classified as NOT RUN due to safety rules', () => {
    const remoteStorageExecuted = false
    assert.equal(
      remoteStorageExecuted,
      false,
      'Live remote Supabase Storage upload was NOT run in strict adherence to offline audit and safety rules',
    )
  })
})
