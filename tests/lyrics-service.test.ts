import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'

import {
  _resetLyricsCacheForTesting,
  cleanTrackArtist,
  cleanTrackTitle,
  fetchTrackLyrics,
  findActiveLyricIndex,
  parseLyrics,
} from '../src/services/lyrics/lyrics-service.ts'

describe('Spotify Lyrics Service & Sidebar Lyrics Integration', () => {
  beforeEach(() => {
    _resetLyricsCacheForTesting()
  })

  describe('1. Title and Artist Normalization', () => {
    it('strips official video and visualizer notations from track titles', () => {
      assert.equal(
        cleanTrackTitle('hate that i made you love me (official music video)'),
        'hate that i made you love me',
      )
      assert.equal(
        cleanTrackTitle('One Last Time (Official Lyric Video)'),
        'One Last Time',
      )
      assert.equal(
        cleanTrackTitle('intro (end of the world) (lyric visualizer)'),
        'intro (end of the world)',
      )
    })

    it('strips extraneous punctuation and lyrics tags', () => {
      assert.equal(
        cleanTrackTitle('Love In The Dark (Lyrics) ??'),
        'Love In The Dark',
      )
      assert.equal(
        cleanTrackTitle('Style'),
        'Style',
      )
    })

    it('preserves words that contain "ft" or "feat" internally like Swift and FEATHER', () => {
      assert.equal(cleanTrackArtist('Taylor Swift'), 'Taylor Swift')
      assert.equal(cleanTrackTitle('BIRDS OF A FEATHER'), 'BIRDS OF A FEATHER')
    })

    it('strips collaborator listings from artist strings', () => {
      assert.equal(
        cleanTrackArtist('The Weeknd, Playboi Carti'),
        'The Weeknd',
      )
      assert.equal(
        cleanTrackArtist('Ariana Grande feat. Nicki Minaj'),
        'Ariana Grande',
      )
      assert.equal(
        cleanTrackArtist('Bleachers & Friends'),
        'Bleachers',
      )
    })
  })

  describe('2. LRC and Plain Lyrics Parsing', () => {
    it('parses plain text lyrics into lines with isSynced = false', () => {
      const plain = 'Line 1\nLine 2\n\nLine 3'
      const parsed = parseLyrics(plain, 'Custom Source')

      assert.equal(parsed.isSynced, false)
      assert.equal(parsed.syncedLines.length, 0)
      assert.equal(parsed.plainLines.length, 4)
      assert.equal(parsed.plainLines[0], 'Line 1')
      assert.equal(parsed.plainLines[1], 'Line 2')
      assert.equal(parsed.plainLines[2], '')
      assert.equal(parsed.plainLines[3], 'Line 3')
      assert.equal(parsed.source, 'Custom Source')
    })

    it('parses LRC time-synced lyrics with fractional seconds into isSynced = true', () => {
      const lrc = '[00:12.50] Midnight\n[00:15.00] You come and pick me up\n[01:02.75] In a white t-shirt'
      const parsed = parseLyrics(lrc)

      assert.equal(parsed.isSynced, true)
      assert.equal(parsed.syncedLines.length, 3)
      assert.equal(parsed.syncedLines[0].timeSeconds, 12.5)
      assert.equal(parsed.syncedLines[0].text, 'Midnight')
      assert.equal(parsed.syncedLines[1].timeSeconds, 15.0)
      assert.equal(parsed.syncedLines[1].text, 'You come and pick me up')
      assert.equal(parsed.syncedLines[2].timeSeconds, 62.75)
      assert.equal(parsed.syncedLines[2].text, 'In a white t-shirt')
    })
  })

  describe('3. Active Line Index Resolution', () => {
    const sampleSynced = [
      { timeSeconds: 10, text: 'First line' },
      { timeSeconds: 20, text: 'Second line' },
      { timeSeconds: 30, text: 'Third line' },
    ]

    it('returns 0 before the first line timestamp', () => {
      assert.equal(findActiveLyricIndex(sampleSynced, 5), 0)
    })

    it('returns exact matching line index when time is between timestamps', () => {
      assert.equal(findActiveLyricIndex(sampleSynced, 12), 0)
      assert.equal(findActiveLyricIndex(sampleSynced, 20), 1)
      assert.equal(findActiveLyricIndex(sampleSynced, 25), 1)
      assert.equal(findActiveLyricIndex(sampleSynced, 30), 2)
      assert.equal(findActiveLyricIndex(sampleSynced, 99), 2)
    })

    it('handles empty synced lines array gracefully', () => {
      assert.equal(findActiveLyricIndex([], 10), -1)
    })
  })

  describe('4. Track Lyrics Fetching & Caching', () => {
    it('uses track.lyrics immediately if present without network requests', async () => {
      let networkCalled = false
      const mockFetch: typeof fetch = async () => {
        networkCalled = true
        return new Response('{}', { status: 200 })
      }

      const result = await fetchTrackLyrics(
        {
          title: 'Custom Track',
          artistName: 'Indie Artist',
          lyrics: 'Hello from local track metadata',
          lyricsSource: 'Local Tag',
        },
        { fetchFn: mockFetch },
      )

      assert.equal(networkCalled, false)
      assert.ok(result)
      assert.equal(result.raw, 'Hello from local track metadata')
      assert.equal(result.source, 'Local Tag')
    })

    it('fetches from API when lyrics are not attached and caches the response', async () => {
      let callCount = 0
      const mockFetch: typeof fetch = async () => {
        callCount++
        return new Response(
          JSON.stringify({
            lyrics: 'Midnight\nYou come and pick me up',
            source: 'Spotify Mock',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      const track = {
        title: 'Style',
        artistName: 'Taylor Swift',
      }

      const res1 = await fetchTrackLyrics(track, { fetchFn: mockFetch })
      assert.ok(res1)
      assert.equal(callCount, 1)
      assert.ok(res1.raw.includes('Midnight'))

      // Second call should hit in-memory cache without calling mockFetch again
      const res2 = await fetchTrackLyrics(track, { fetchFn: mockFetch })
      assert.ok(res2)
      assert.equal(callCount, 1, 'Second fetch should be served from memory cache')
      assert.equal(res2.raw, res1.raw)
    })

    it('returns null when title or artist is empty', async () => {
      const res1 = await fetchTrackLyrics({ title: '', artistName: 'Artist' })
      assert.equal(res1, null)

      const res2 = await fetchTrackLyrics({ title: 'Song', artistName: '' })
      assert.equal(res2, null)
    })
  })
})
