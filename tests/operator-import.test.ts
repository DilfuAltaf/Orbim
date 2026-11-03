import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  MAX_OPERATOR_BATCH_SIZE,
  executeOperatorImport,
  normalizeSongKey,
  validateOperatorTrack,
  type OperatorTrackInput,
} from '../src/services/import/operator-workflow.ts'

describe('Operator Workflow: Batch Limit & Validation', () => {
  it('enforces maximum 11 songs per batch constant', () => {
    assert.equal(MAX_OPERATOR_BATCH_SIZE, 11)
  })

  it('validates a complete track properly', () => {
    const raw: OperatorTrackInput = {
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      album: 'A Night at the Opera',
      artworkUrl: 'https://example.com/artwork.jpg',
      durationSeconds: 354,
      audioSourceType: 'direct_stream',
      audioSourceUrl: 'https://example.com/audio.mp3',
    }

    const validated = validateOperatorTrack(raw)
    assert.equal(validated.valid, true)
    assert.equal(validated.title, 'Bohemian Rhapsody')
    assert.equal(validated.artistName, 'Queen')
    assert.equal(validated.albumName, 'A Night at the Opera')
    assert.equal(validated.artworkUrl, 'https://example.com/artwork.jpg')
    assert.equal(validated.durationSeconds, 354)
    assert.equal(validated.audioSourceType, 'direct_stream')
    assert.equal(validated.isPartialData, false)
    assert.equal(validated.validationErrors.length, 0)
  })

  it('flags missing required title or artist as invalid', () => {
    const noTitle = validateOperatorTrack({ title: '', artist: 'Queen' })
    assert.equal(noTitle.valid, false)
    assert.ok(noTitle.validationErrors.some((e) => e.includes('Judul lagu')))

    const noArtist = validateOperatorTrack({ title: 'Song', artist: '' })
    assert.equal(noArtist.valid, false)
    assert.ok(noArtist.validationErrors.some((e) => e.includes('Nama artis')))
  })

  it('identifies partial metadata safely (missing album, artwork, duration, audio)', () => {
    const partialTrack: OperatorTrackInput = {
      title: 'Acoustic Demo',
      artist: 'Local Singer',
    }

    const validated = validateOperatorTrack(partialTrack)
    assert.equal(validated.valid, true) // Valid to save, but partial
    assert.equal(validated.isPartialData, true)
    assert.ok(validated.partialNotes.includes('album_belum_diketahui'))
    assert.ok(validated.partialNotes.includes('artwork_belum_tersedia'))
    assert.ok(validated.partialNotes.includes('durasi_belum_diketahui'))
    assert.ok(validated.partialNotes.includes('audio_belum_tersedia'))
  })

  it('handles lyrics safely without scraping or hallucination', () => {
    // 1. By default lyricsStatus is not_available
    const track1 = validateOperatorTrack({ title: 'Song 1', artist: 'Artist 1' })
    assert.equal(track1.lyricsStatus, 'not_available')
    assert.equal(track1.lyrics, undefined)

    // 2. Partial snippet support with licensing compliance
    const track2 = validateOperatorTrack({
      title: 'Song 2',
      artist: 'Artist 2',
      lyricsSnippet: 'Is this the real life? Is this just fantasy?',
      lyricsSource: 'Verified Fair Use Excerpt',
    })
    assert.equal(track2.lyricsStatus, 'partial')
    assert.equal(track2.lyricsSnippet, 'Is this the real life? Is this just fantasy?')
    assert.equal(track2.lyrics, undefined) // no full lyrics claimed
  })
})

describe('Operator Workflow: Deduplication Normalization', () => {
  it('normalizes song keys across various punctuations, casing, and spaces', () => {
    const key1 = normalizeSongKey('Fix You', 'Coldplay')
    const key2 = normalizeSongKey('fix you', 'coldplay')
    const key3 = normalizeSongKey('Fix  You!!', 'COLDPLAY')

    assert.equal(key1, key2)
    assert.equal(key2, key3)
  })
})

describe('Operator Workflow: Execution & Supabase Integration', () => {
  // Mock Supabase client generator
  function createMockSupabase(options?: {
    authenticatedUser?: { id: string; email: string } | null
    existingPlaylistTracks?: Array<{
      id: string
      title: string
      artist_name: string
      position: number
      provider_track_id: string
    }>
    failInsert?: boolean
    failVerify?: boolean
  }) {
    const user = options?.authenticatedUser !== undefined
      ? options.authenticatedUser
      : { id: 'user_operator_123', email: 'operator@orbim.local' }

    const storedRows: any[] = [...(options?.existingPlaylistTracks || [])]

    return {
      auth: {
        getUser: async () => {
          if (!user) {
            return { data: { user: null }, error: { message: 'Not authenticated' } }
          }
          return { data: { user }, error: null }
        },
      },
      from: (table: string) => {
        if (table !== 'playlist_tracks') {
          throw new Error(`Unexpected table ${table}`)
        }

        return {
          select: (_columns: string) => {
            return {
              eq: (field: string, val: string) => {
                return {
                  order: (_orderCol: string, _opts: any) => {
                    const matched = storedRows.filter((r) => r.playlist_id === val || !r.playlist_id)
                    return Promise.resolve({ data: matched, error: null })
                  },
                  in: (_inCol: string, inVals: string[]) => {
                    if (options?.failVerify) {
                      return Promise.resolve({ data: null, error: { message: 'Database read failed' } })
                    }
                    const matched = storedRows.filter((r) => inVals.includes(r.provider_track_id))
                    return Promise.resolve({ data: matched, error: null })
                  },
                }
              },
            }
          },
          insert: (rows: any[]) => {
            if (options?.failInsert) {
              return Promise.resolve({ data: null, error: { message: 'RLS violation: insert not allowed' } })
            }
            for (const r of rows) {
              storedRows.push({
                id: `db_id_${Math.random().toString(36).substring(2, 7)}`,
                ...r,
              })
            }
            return {
              select: (_cols: string) => Promise.resolve({ data: storedRows, error: null }),
            }
          },
        } as any
      },
    } as any
  }

  it('rejects execution if operator is not authenticated in Supabase', async () => {
    const mockSupabase = createMockSupabase({ authenticatedUser: null })
    await assert.rejects(
      async () => {
        await executeOperatorImport({
          supabase: mockSupabase,
          playlistId: 'playlist-001',
          tracks: [{ title: 'Track 1', artist: 'Artist 1' }],
        })
      },
      /Supabase authentication diperlukan/,
    )
  })

  it('truncates inputs exceeding 11 tracks and records wasTruncated = true', async () => {
    const mockSupabase = createMockSupabase()
    const tracks: OperatorTrackInput[] = Array.from({ length: 15 }, (_, i) => ({
      title: `Song ${i + 1}`,
      artist: `Artist ${i + 1}`,
    }))

    const report = await executeOperatorImport({
      supabase: mockSupabase,
      playlistId: 'playlist-001',
      tracks,
    })

    assert.equal(report.batchLimit, 11)
    assert.equal(report.totalReceived, 15)
    assert.equal(report.totalProcessed, 11)
    assert.equal(report.wasTruncated, true)
    assert.equal(report.succeeded.length, 11)
  })

  it('detects duplicates within the batch and existing in the target playlist', async () => {
    const mockSupabase = createMockSupabase({
      existingPlaylistTracks: [
        {
          id: 'existing-1',
          title: 'Existing Song',
          artist_name: 'Existing Artist',
          position: 1000,
          provider_track_id: 'orb_001',
        },
      ],
    })

    const tracks: OperatorTrackInput[] = [
      { title: 'New Song A', artist: 'Band A' },
      { title: 'Existing Song', artist: 'Existing Artist' }, // duplicate in playlist
      { title: 'New Song B', artist: 'Band B' },
      { title: 'New Song A', artist: 'Band A' }, // duplicate in batch
    ]

    const report = await executeOperatorImport({
      supabase: mockSupabase,
      playlistId: 'playlist-001',
      tracks,
    })

    assert.equal(report.succeeded.length, 2)
    assert.equal(report.duplicates.length, 2)

    const inBatchDup = report.duplicates.find((d) => d.reason === 'duplicate_in_batch')
    assert.ok(inBatchDup)
    assert.equal(inBatchDup.title, 'New Song A')

    const inPlaylistDup = report.duplicates.find((d) => d.reason === 'duplicate_in_target_playlist')
    assert.ok(inPlaylistDup)
    assert.equal(inPlaylistDup.title, 'Existing Song')
  })

  it('identifies and reports partial data tracks in needsCorrection', async () => {
    const mockSupabase = createMockSupabase()
    const tracks: OperatorTrackInput[] = [
      {
        title: 'Complete Song',
        artist: 'Band',
        album: 'Album 1',
        artworkUrl: 'https://example.com/art.jpg',
        durationSeconds: 200,
        audioSourceType: 'direct_stream',
        audioSourceUrl: 'https://example.com/stream.mp3',
      },
      {
        title: 'Partial Song',
        artist: 'Soloist',
        // missing album, artwork, duration, audio
      },
    ]

    const report = await executeOperatorImport({
      supabase: mockSupabase,
      playlistId: 'playlist-001',
      tracks,
    })

    assert.equal(report.succeeded.length, 2)
    assert.equal(report.needsCorrection.length, 1)
    assert.equal(report.needsCorrection[0].title, 'Partial Song')
    assert.ok(report.needsCorrection[0].notes.includes('album_belum_diketahui'))
  })

  it('verifies saved tracks through database re-read', async () => {
    const mockSupabase = createMockSupabase()
    const tracks: OperatorTrackInput[] = [
      { title: 'Song 1', artist: 'Artist 1' },
      { title: 'Song 2', artist: 'Artist 2' },
    ]

    const report = await executeOperatorImport({
      supabase: mockSupabase,
      playlistId: 'playlist-001',
      tracks,
    })

    assert.equal(report.succeeded.length, 2)
    for (const item of report.succeeded) {
      assert.equal(item.verified, true)
      assert.ok(item.id)
    }
  })
})
