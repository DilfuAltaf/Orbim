import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  MAX_IMPORT_BATCH_SIZE,
  createCustomTrack,
  normalizeSongKey,
  parseArtistAndTitles,
  parseCsvContent,
  parseFreeformLines,
  resolveImportRows,
} from '../src/services/import/song-import.ts'
import type { MusicProvider } from '../src/services/music/types.ts'
import type { MusicTrack } from '../src/types/music.ts'

describe('Bulk Song Import: Parsers', () => {
  it('parses artist and numbered titles list cleanly', () => {
    const raw = `
      1. Yellow
      2) Fix You
      3 - The Scientist
      • Viva La Vida
      "Clocks"
    `
    const res = parseArtistAndTitles('Coldplay', raw)

    assert.equal(res.rows.length, 5)
    assert.equal(res.wasTruncated, false)
    assert.equal(res.rows[0].title, 'Yellow')
    assert.equal(res.rows[0].artistName, 'Coldplay')
    assert.equal(res.rows[1].title, 'Fix You')
    assert.equal(res.rows[2].title, 'The Scientist')
    assert.equal(res.rows[3].title, 'Viva La Vida')
    assert.equal(res.rows[4].title, 'Clocks')
  })

  it('enforces maximum 11 songs per batch for artist & titles mode', () => {
    const lines = Array.from({ length: 25 }, (_, i) => `Song Title ${i + 1}`).join('\n')
    const res = parseArtistAndTitles('Test Artist', lines)

    assert.equal(res.totalFound, 25)
    assert.equal(res.rows.length, MAX_IMPORT_BATCH_SIZE)
    assert.equal(res.wasTruncated, true)
    assert.equal(res.rows[10].title, 'Song Title 11')
  })

  it('parses freeform lines with various separators', () => {
    const raw = `
      Coldplay - Yellow - Parachutes
      Queen - Bohemian Rhapsody
      Hotel California by Eagles
      Radiohead | Creep | Pablo Honey
    `
    const res = parseFreeformLines(raw)

    assert.equal(res.rows.length, 4)
    assert.equal(res.rows[0].artistName, 'Coldplay')
    assert.equal(res.rows[0].title, 'Yellow')
    assert.equal(res.rows[0].albumName, 'Parachutes')

    assert.equal(res.rows[1].artistName, 'Queen')
    assert.equal(res.rows[1].title, 'Bohemian Rhapsody')

    assert.equal(res.rows[2].artistName, 'Eagles')
    assert.equal(res.rows[2].title, 'Hotel California')

    assert.equal(res.rows[3].artistName, 'Radiohead')
    assert.equal(res.rows[3].title, 'Creep')
    assert.equal(res.rows[3].albumName, 'Pablo Honey')
  })

  it('parses comma-delimited CSV with standard headers', () => {
    const csv = `title,artist,album
"Yellow",Coldplay,Parachutes
"Fix You",Coldplay,"X&Y"
The Scientist,Coldplay,A Rush of Blood to the Head`

    const res = parseCsvContent(csv)
    assert.equal(res.rows.length, 3)
    assert.equal(res.rows[0].title, 'Yellow')
    assert.equal(res.rows[0].artistName, 'Coldplay')
    assert.equal(res.rows[0].albumName, 'Parachutes')
    assert.equal(res.rows[1].albumName, 'X&Y')
  })

  it('parses semicolon-delimited CSV with Indonesian headers', () => {
    const csv = `judul;penyanyi;album
Dan;Sheila On 7;Kisah Klasik Untuk Masa Depan
Kangen;Dewa 19;Format Masa Depan`

    const res = parseCsvContent(csv)
    assert.equal(res.rows.length, 2)
    assert.equal(res.rows[0].title, 'Dan')
    assert.equal(res.rows[0].artistName, 'Sheila On 7')
    assert.equal(res.rows[1].title, 'Kangen')
    assert.equal(res.rows[1].artistName, 'Dewa 19')
  })

  it('enforces maximum 11 batch limit in CSV parser', () => {
    let csv = 'title,artist\n'
    for (let i = 0; i < 20; i++) {
      csv += `Track ${i + 1},Artist ${i + 1}\n`
    }
    const res = parseCsvContent(csv)
    assert.equal(res.totalFound, 20)
    assert.equal(res.rows.length, 11)
    assert.equal(res.wasTruncated, true)
  })
})

describe('Bulk Song Import: Deduplication & Normalization', () => {
  it('normalizes song keys ignoring punctuation, case, and spacing', () => {
    const key1 = normalizeSongKey("Don't Panic", 'Coldplay')
    const key2 = normalizeSongKey('dont panic', 'coldplay')
    const key3 = normalizeSongKey('Don’t   Panic!', 'COLDPLAY ')

    assert.equal(key1, key2)
    assert.equal(key2, key3)
  })
})

describe('Bulk Song Import: Resolution & Lyrics Compliance', () => {
  const dummyTrack = (id: string, title: string, artist: string): MusicTrack => ({
    provider: 'orbim',
    providerTrackId: id,
    title,
    artistName: artist,
    durationSeconds: 180,
    genre: 'Indie',
    moods: [],
    isPlayable: true,
  })

  const mockProvider: MusicProvider = {
    id: 'orbim',
    name: 'Mock Database Provider',
    async searchTracks(query: string) {
      if (query.toLowerCase().includes('yellow')) {
        return [dummyTrack('101', 'Yellow', 'Coldplay')]
      }
      if (query.toLowerCase().includes('ambiguous')) {
        return [
          dummyTrack('201', 'Ambiguous Song (Version A)', 'Indie Band'),
          dummyTrack('202', 'Ambiguous Song (Version B)', 'Indie Band'),
        ]
      }
      return []
    },
    async getTrack() {
      return null
    },
  }

  it('marks exact match as matched and resolves metadata', async () => {
    const rows = [{ rawIndex: 1, title: 'Yellow', artistName: 'Coldplay' }]
    const items = await resolveImportRows(rows, { provider: mockProvider })

    assert.equal(items.length, 1)
    assert.equal(items[0].status, 'matched')
    assert.equal(items[0].resolvedTrack.providerTrackId, '101')
    assert.equal(items[0].resolvedTrack.title, 'Yellow')
    assert.equal(items[0].isSelected, true)
    // Lyrics compliance
    assert.equal(items[0].resolvedTrack.lyricsStatus, 'not_available')
    assert.equal(items[0].resolvedTrack.lyrics, undefined)
  })

  it('flags ambiguous matches and supplies candidates for user selection', async () => {
    const rows = [{ rawIndex: 1, title: 'Ambiguous', artistName: 'Indie Band' }]
    const items = await resolveImportRows(rows, { provider: mockProvider })

    assert.equal(items.length, 1)
    assert.equal(items[0].status, 'ambiguous')
    assert.equal(items[0].candidates.length, 2)
  })

  it('detects duplicate songs within the imported batch', async () => {
    const rows = [
      { rawIndex: 1, title: 'Yellow', artistName: 'Coldplay' },
      { rawIndex: 2, title: 'Yellow', artistName: 'Coldplay' },
    ]
    const items = await resolveImportRows(rows, { provider: mockProvider })

    assert.equal(items.length, 2)
    assert.equal(items[0].isDuplicateInBatch, false)
    assert.equal(items[0].isSelected, true)
    assert.equal(items[1].isDuplicateInBatch, true)
    assert.equal(items[1].isSelected, false) // unselected by default
  })

  it('detects duplicate songs existing in target playlist', async () => {
    const targetTracks: MusicTrack[] = [dummyTrack('101', 'Yellow', 'Coldplay')]
    const rows = [
      { rawIndex: 1, title: 'Yellow', artistName: 'Coldplay' },
      { rawIndex: 2, title: 'Fix You', artistName: 'Coldplay' },
    ]

    const items = await resolveImportRows(rows, {
      provider: mockProvider,
      targetExistingTracks: targetTracks,
    })

    assert.equal(items[0].isDuplicateInTarget, true)
    assert.equal(items[0].isSelected, false) // unselected by default

    assert.equal(items[1].isDuplicateInTarget, false)
    assert.equal(items[1].isSelected, true)
  })

  it('creates clean custom tracks without scraping or hallucinating lyrics', () => {
    const track = createCustomTrack({
      rawIndex: 1,
      title: 'Original Song',
      artistName: 'Independent Musician',
      albumName: 'Demo Tape',
    })

    assert.equal(track.provider, 'orbim')
    assert.equal(track.title, 'Original Song')
    assert.equal(track.artistName, 'Independent Musician')
    assert.equal(track.albumName, 'Demo Tape')
    assert.equal(track.lyricsStatus, 'not_available')
    assert.equal(track.lyrics, undefined)
  })

  it('safely handles and tags partial track data when artist or album is absent', async () => {
    const rows = [
      { rawIndex: 1, title: 'Solo Title Without Artist', artistName: 'Unknown Artist' },
    ]
    const items = await resolveImportRows(rows, { provider: mockProvider })

    assert.equal(items.length, 1)
    assert.equal(items[0].isPartialData, true)
    assert.equal(items[0].resolvedTrack.title, 'Solo Title Without Artist')
    assert.equal(items[0].resolvedTrack.artistName, 'Unknown Artist')
    assert.equal(items[0].resolvedTrack.albumName, undefined)
  })

  it('supports partial lyrics snippets safely without claiming full license', () => {
    const track: MusicTrack = {
      ...dummyTrack('301', 'Partial Song', 'Artist'),
      lyricsStatus: 'partial',
      lyricsSnippet: 'Look at the stars, look how they shine for you...',
      lyricsNotice: 'Cuplikan lirik aman ditampilkan.',
    }

    assert.equal(track.lyricsStatus, 'partial')
    assert.ok(track.lyricsSnippet?.includes('Look at the stars'))
    assert.equal(track.lyrics, undefined)
  })
})
