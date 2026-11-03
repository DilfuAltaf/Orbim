import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  lyricsTrackKey,
  readLyricsPanelOpen,
  resolveLyricsPanelState,
} from '../src/features/lyrics/lyrics-panel-state.ts'
import { parseLyrics } from '../src/services/lyrics/lyrics-service.ts'
import type { MusicTrack } from '../src/types/music.ts'

/**
 * Right-hand lyrics panel: empty / unavailable / plain / synced presentation,
 * active-line tracking against the real playback position, and track switching.
 */

function makeTrack(overrides: Partial<MusicTrack> & { title: string }): MusicTrack {
  return {
    provider: 'orbim',
    providerTrackId: `lyrics-${overrides.title}`,
    artistName: 'ORBIM Artist',
    durationSeconds: 210,
    genre: 'Pop',
    moods: [],
    isPlayable: true,
    playbackUrl: 'https://cdn.example.test/orbim/lyrics.mp3',
    publicationStatus: 'published',
    ...overrides,
  }
}

const syncedLyrics = parseLyrics(
  ['[00:00.00]First line', '[00:10.00]Second line', '[00:25.50]Third line'].join('\n'),
)

const plainLyrics = parseLyrics(['Just a plain verse', 'and a plain chorus'].join('\n'))

describe('Lyrics panel state', () => {
  describe('Empty state', () => {
    it('asks for a track when nothing is playing', () => {
      const state = resolveLyricsPanelState({
        track: null,
        lyrics: null,
        isLoading: false,
        error: null,
        elapsedSeconds: 0,
      })

      assert.equal(state.kind, 'empty')
      assert.equal(state.trackKey, null)
    })
  })

  describe('Unavailable lyrics', () => {
    it('explains that lyrics are unavailable instead of inventing lines', () => {
      const state = resolveLyricsPanelState({
        track: makeTrack({ title: 'No lyrics here' }),
        lyrics: null,
        isLoading: false,
        error: null,
        elapsedSeconds: 12,
      })

      assert.equal(state.kind, 'unavailable')
      if (state.kind !== 'unavailable') return
      assert.match(state.message, /not available/i)
      assert.ok(!('lines' in state))
    })

    it('surfaces the provider error when one is reported', () => {
      const state = resolveLyricsPanelState({
        track: makeTrack({ title: 'Provider failure' }),
        lyrics: null,
        isLoading: false,
        error: 'Lyrics provider is temporarily unavailable.',
        elapsedSeconds: 0,
      })

      assert.equal(state.kind, 'unavailable')
      if (state.kind !== 'unavailable') return
      assert.equal(state.message, 'Lyrics provider is temporarily unavailable.')
    })
  })

  describe('Plain lyrics', () => {
    it('renders untimed lyrics without pretending they are synchronized', () => {
      const state = resolveLyricsPanelState({
        track: makeTrack({ title: 'Plain song' }),
        lyrics: plainLyrics,
        isLoading: false,
        error: null,
        elapsedSeconds: 40,
      })

      assert.equal(state.kind, 'plain')
      if (state.kind !== 'plain') return
      assert.deepEqual(state.lines, ['Just a plain verse', 'and a plain chorus'])
      assert.equal('activeIndex' in state, false)
    })
  })

  describe('Synchronized lyrics', () => {
    it('highlights the line that matches the audio position', () => {
      const track = makeTrack({ title: 'Timed song' })
      const at = (elapsedSeconds: number) =>
        resolveLyricsPanelState({
          track,
          lyrics: syncedLyrics,
          isLoading: false,
          error: null,
          elapsedSeconds,
        })

      for (const [elapsedSeconds, expected] of [
        [0, 0],
        [9.9, 0],
        [10, 1],
        [25.4, 1],
        [25.5, 2],
        [180, 2],
      ] as const) {
        const state = at(elapsedSeconds)
        assert.equal(state.kind, 'synced')
        if (state.kind !== 'synced') return
        assert.equal(state.activeIndex, expected, `position ${elapsedSeconds}s`)
      }
    })

    it('follows seeking, pausing and resuming through the reported position', () => {
      const track = makeTrack({ title: 'Seekable song' })
      const resolve = (elapsedSeconds: number) =>
        resolveLyricsPanelState({
          track,
          lyrics: syncedLyrics,
          isLoading: false,
          error: null,
          elapsedSeconds,
        })

      // Seek forward, then back: the active line tracks the player position only.
      const forward = resolve(30)
      const backward = resolve(1)

      assert.equal(forward.kind, 'synced')
      assert.equal(backward.kind, 'synced')
      if (forward.kind !== 'synced' || backward.kind !== 'synced') return
      assert.equal(forward.activeIndex, 2)
      assert.equal(backward.activeIndex, 0)

      // Paused playback reports the same position, so the highlight does not drift.
      const paused = resolve(30)
      assert.equal(paused.kind, 'synced')
      if (paused.kind !== 'synced') return
      assert.equal(paused.activeIndex, forward.activeIndex)
    })

    it('switches lyrics when the player moves to another track', () => {
      const first = makeTrack({ title: 'First song' })
      const second = makeTrack({ title: 'Second song' })

      const before = resolveLyricsPanelState({
        track: first,
        lyrics: syncedLyrics,
        isLoading: false,
        error: null,
        elapsedSeconds: 12,
      })
      const after = resolveLyricsPanelState({
        track: second,
        lyrics: parseLyrics('[00:00.00]Other track line'),
        isLoading: false,
        error: null,
        elapsedSeconds: 12,
      })

      assert.equal(before.kind, 'synced')
      assert.equal(after.kind, 'synced')
      if (before.kind !== 'synced' || after.kind !== 'synced') return

      assert.notEqual(before.trackKey, after.trackKey)
      assert.equal(before.trackKey, lyricsTrackKey(first))
      assert.deepEqual(
        after.lines.map((line) => line.text),
        ['Other track line'],
      )
      assert.equal(after.activeIndex, 0)
    })
  })

  describe('Loading and preferences', () => {
    it('shows a loading state while keeping the requested track bound', () => {
      const track = makeTrack({ title: 'Loading song' })

      const state = resolveLyricsPanelState({
        track,
        lyrics: null,
        isLoading: true,
        error: null,
        elapsedSeconds: 0,
      })

      assert.equal(state.kind, 'loading')
      assert.equal(state.trackKey, lyricsTrackKey(track))
    })

    it('defaults the panel to collapsed outside the browser', () => {
      assert.equal(readLyricsPanelOpen(), false)
    })
  })
})
