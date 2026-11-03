import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Html5AudioEngine } from '../src/features/player/html5-audio-engine.ts'
import { hasDirectAudioUrl, selectTrackPlayback } from '../src/features/player/playback-engine.ts'
import {
  initialState,
  playerReducer,
} from '../src/features/player/player-reducer.ts'
import { resolveEffectiveTrack } from '../src/services/audio/global-audio-registry.ts'
import { resolveStoragePublicUrl } from '../src/services/audio/audio-storage.ts'
import { mapCatalogRecordToMusicTrack } from '../src/services/catalog/global-catalog-service.ts'
import { mapPlaylistTrackRow } from '../src/services/playlist/track-mapping.ts'
import type { MusicTrack } from '../src/types/music.ts'

/**
 * Player engine abstraction tests (P1).
 *
 * All audio is mocked: no real Spotify credentials, network or media playback
 * is required. These tests lock both the extracted HTML5 engine behavior and
 * the fact that Spotify metadata never reaches the HTML5 engine.
 */

type Listener = (event: Event) => void

/**
 * Minimal HTMLAudioElement stand-in that reproduces the event semantics the
 * engine relies on: play/pause mutates paused + emits, error surfaces .error,
 * removeAttribute clears the source (as the DOM exposes via the src property).
 */
class FakeHtmlAudioElement {
  src = ''
  currentTime = 0
  duration = NaN
  volume = 1
  paused = true
  ended = false
  preload = ''
  error: { code: number; message: string } | null = null
  private listeners = new Map<string, Listener[]>()

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }

  removeEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? []
    this.listeners.set(
      type,
      list.filter((registered) => registered !== listener),
    )
  }

  removeAttribute(_name: string): void {
    this.src = ''
  }

  load(): void {
    // No-op, matching attribute-less media loading.
  }

  play(): Promise<void> {
    if (!this.src) {
      return Promise.reject(new Error('No supported source'))
    }
    this.paused = false
    this.emit('playing')
    return Promise.resolve()
  }

  pause(): void {
    if (this.paused) return
    this.paused = true
    this.emit('pause')
  }

  emit(type: string): void {
    const event = new Event(type)
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }

  listenerCount(type: string): number {
    return (this.listeners.get(type) ?? []).length
  }
}

function makeTrack(overrides: Partial<MusicTrack> = {}): MusicTrack {
  return {
    provider: 'demo',
    providerTrackId: 'track-1',
    title: 'Test Track',
    artistName: 'Tester',
    durationSeconds: 180,
    genre: 'Test',
    moods: [],
    isPlayable: true,
    ...overrides,
  }
}

describe('Playback engine contract & selection', () => {
  it('routes tracks with a real audio URL to the HTML5 engine regardless of provider', () => {
    assert.equal(selectTrackPlayback(makeTrack({ provider: 'orbim', playbackUrl: 'https://example.com/audio/stream.mp3' })), 'html5-audio')
    assert.equal(selectTrackPlayback(makeTrack({ provider: 'demo', playbackUrl: 'https://example.com/audio/stream.wav' })), 'html5-audio')
    assert.equal(selectTrackPlayback(makeTrack({ provider: 'custom', playbackUrl: 'https://cdn.example.com/song.flac' })), 'html5-audio')
  })

  it('never sends Spotify tracks to HTML5 playback merely because they contain metadata', () => {
    // Spotify ids in every test fixture below are invalid on purpose: only a
    // valid 22-character base62 id may route a metadata-only Spotify track to
    // the Web Playback SDK engine (P2 behavior, asserted fully in
    // tests/spotify-engine.test.ts).
    assert.equal(selectTrackPlayback(makeTrack({ provider: 'spotify' })), 'unsupported')
    assert.equal(
      selectTrackPlayback(makeTrack({ provider: 'spotify', playbackUrl: undefined })),
      'unsupported',
      'Spotify metadata must not fabricate a playbackUrl',
    )
    assert.equal(
      hasDirectAudioUrl(makeTrack({ provider: 'spotify' })),
      false,
      'Spotify metadata must never grow an audio URL by itself',
    )
  })

  it('routes metadata-only Spotify tracks with a valid id to the Web Playback SDK engine', () => {
    assert.equal(
      selectTrackPlayback(
        makeTrack({ provider: 'spotify', providerTrackId: '3n3Ppam7vgaVa1iaRUc9Lp' }),
      ),
      'spotify-sdk',
    )
  })

  it('treats missing or malformed Spotify track ids as unsupported', () => {
    assert.equal(
      selectTrackPlayback(makeTrack({ provider: 'spotify', providerTrackId: '' })),
      'unsupported',
    )
    assert.equal(
      selectTrackPlayback(makeTrack({ provider: 'spotify', providerTrackId: 'short-id' })),
      'unsupported',
    )
    assert.equal(
      selectTrackPlayback(
        makeTrack({ provider: 'spotify', providerTrackId: 'a'.repeat(21) }),
      ),
      'unsupported',
    )
    assert.equal(
      selectTrackPlayback(
        makeTrack({ provider: 'spotify', providerTrackId: 'has!invalid@chars!!here!?x' }),
      ),
      'unsupported',
      'Non-base62 characters must be rejected',
    )
  })

  it('keeps today\'s behavior for a Spotify track that already carries a real preview URL', () => {
    // Preserved for byte-for-byte current behavior; P2 replaces this path.
    assert.equal(selectTrackPlayback(makeTrack({ provider: 'spotify', playbackUrl: 'https://p.scdn.co/mp3-preview.mp3' })), 'html5-audio')
  })

  it('keeps demo-mode behavior exactly: fixtures without audio use the timer fallback', () => {
    assert.equal(selectTrackPlayback(makeTrack({ provider: 'demo' })), 'timer-fallback')
    assert.equal(selectTrackPlayback(makeTrack({ provider: 'orbim', isPlayable: false })), 'timer-fallback')
  })

  it('keeps same-origin /assets/audio sources playable', () => {
    const track = makeTrack({
      provider: 'spotify',
      providerTrackId: 'local-assets-track',
      playbackUrl: '/assets/audio/global/track.mp3',
      audioSourceType: 'direct_stream',
    })

    const effective = resolveEffectiveTrack(track)
    assert.ok(effective)
    assert.equal(effective?.isPlayable, true, 'Locally served audio must stay playable')
    assert.equal(effective?.playbackUrl, '/assets/audio/global/track.mp3')
    assert.equal(selectTrackPlayback(effective!), 'html5-audio')
  })

  it('treats missing, blank, or whitespace-only audio URLs as no audio', () => {
    assert.equal(hasDirectAudioUrl(makeTrack({ playbackUrl: '' })), false)
    assert.equal(hasDirectAudioUrl(makeTrack({ playbackUrl: '   ' })), false)
    assert.equal(hasDirectAudioUrl(makeTrack({ playbackUrl: undefined })), false)
    assert.equal(selectTrackPlayback(makeTrack({ playbackUrl: '   ' })), 'timer-fallback')
  })
})

describe('Html5AudioEngine (fake audio element)', () => {
  function createEngine(audio: FakeHtmlAudioElement) {
    const received: unknown[] = []
    const engine = new Html5AudioEngine({
      audio: audio as unknown as HTMLAudioElement,
      events: {
        onTime: (seconds) => received.push({ kind: 'time', seconds }),
        onWaiting: () => received.push({ kind: 'waiting' }),
        onPlaying: () => received.push({ kind: 'playing' }),
        onPause: () => received.push({ kind: 'pause' }),
        onEnded: () => received.push({ kind: 'ended' }),
        onError: (detail) => received.push({ kind: 'error', detail }),
      },
    })
    return { engine, received }
  }

  it('initializes with browser-like defaults and attaches its listeners', () => {
    const audio = new FakeHtmlAudioElement()
    const { engine, received } = createEngine(audio)

    assert.equal(audio.preload, 'metadata')
    assert.equal(audio.volume, 1)
    assert.equal(audio.listenerCount('timeupdate'), 1)
    assert.equal(audio.listenerCount('ended'), 1)
    assert.equal(engine.hasSource(), false)
    assert.equal(engine.currentSource(), null)
    assert.equal(received.length, 0)
  })

  it('loads a valid track: swaps the source and rewinds to the start', () => {
    const audio = new FakeHtmlAudioElement()
    const { engine } = createEngine(audio)

    engine.load(makeTrack({ provider: 'orbim', playbackUrl: 'https://example.com/a.ogg' }))
    assert.equal(audio.src, 'https://example.com/a.ogg')
    assert.equal(engine.currentSource(), 'https://example.com/a.ogg')
    assert.equal(engine.hasSource(), true)
    assert.equal(audio.currentTime, 0)
  })

  it('refuses to load metadata-only tracks (no fabricated URLs, incl. Spotify records)', () => {
    const audio = new FakeHtmlAudioElement()
    const { engine } = createEngine(audio)

    assert.throws(
      () => engine.load(makeTrack({ provider: 'spotify' })),
      /without a concrete audio URL/,
    )
    assert.throws(
      () => engine.load(makeTrack({ provider: 'orbim', playbackUrl: '  ' })),
      /without a concrete audio URL/,
    )
    assert.equal(audio.src, '')
  })

  it('plays, reports playing, pauses and reports pauses', async () => {
    const audio = new FakeHtmlAudioElement()
    const { engine, received } = createEngine(audio)

    engine.load(makeTrack({ provider: 'orbim', playbackUrl: 'https://example.com/a.ogg' }))
    await engine.play()

    assert.equal(audio.paused, false)
    assert.ok(received.some((event) => (event as { kind: string }).kind === 'playing'))

    engine.pause()
    assert.equal(audio.paused, true)
    assert.ok(received.some((event) => (event as { kind: string }).kind === 'pause'))
  })

  it('rejects play() without a usable source instead of crashing', async () => {
    const audio = new FakeHtmlAudioElement()
    const { engine } = createEngine(audio)

    await assert.rejects(
      async () => {
        await engine.play()
      },
      /no audio source loaded/,
    )
    assert.equal(audio.paused, true)
  })

  it('reports time only while actually playing, with floor precision', () => {
    const audio = new FakeHtmlAudioElement()
    const { engine, received } = createEngine(audio)

    engine.load(makeTrack({ provider: 'orbim', playbackUrl: 'https://example.com/a.ogg' }))

    // Paused element: a timeupdate must not report progress (original guard).
    audio.currentTime = 12.7
    audio.emit('timeupdate')
    assert.equal(received.length, 0)

    // While playing: timeupdate reports the floored position.
    audio.paused = false
    audio.currentTime = 12.7
    audio.emit('timeupdate')
    assert.ok(received.some((event) => (event as { kind: string }).kind === 'time'))
    assert.equal((received.find((e) => (e as { kind: string }).kind === 'time') as { seconds: number }).seconds, 12)

    // Paused again: no more time events (preserves the original guard).
    audio.paused = true
    const count = received.length
    audio.currentTime = 13.9
    audio.emit('timeupdate')
    assert.equal(received.length, count)
  })

  it('preserves the original error handling: guard when no source, exact detail format', () => {
    const audio = new FakeHtmlAudioElement()
    const { engine, received } = createEngine(audio)

    // No source loaded: original code swallowed the error informer.
    audio.error = { code: 4, message: 'Media decoder error' }
    audio.emit('error')
    assert.equal(received.length, 0)

    // With a source: error detail matches the previous formatting.
    engine.load(makeTrack({ provider: 'orbim', playbackUrl: 'https://example.com/a.ogg' }))
    audio.error = { code: 4, message: 'Media decoder error' }
    audio.emit('error')
    assert.deepEqual(received[0], { kind: 'error', detail: 'Code 4: Media decoder error' })

    // Missing error object: original fallback detail.
    audio.error = null
    audio.emit('error')
    assert.deepEqual(received[1], { kind: 'error', detail: 'Network or decoding error' })
  })

  it('clear() drops the source and silences playback', async () => {
    const audio = new FakeHtmlAudioElement()
    const { engine } = createEngine(audio)

    engine.load(makeTrack({ provider: 'orbim', playbackUrl: 'https://example.com/a.ogg' }))
    await engine.play()
    engine.clear()

    assert.equal(engine.hasSource(), false)
    assert.equal(audio.paused, true)
    assert.equal(engine.currentSource(), null)
  })

  it('seekTo clamps negatives and reports duration only when finite', () => {
    const audio = new FakeHtmlAudioElement()
    const { engine } = createEngine(audio)

    audio.duration = 120
    assert.equal(engine.getDuration(), 120)

    engine.seekTo(-5)
    assert.equal(audio.currentTime, 0)

    engine.seekTo(42)
    assert.equal(audio.currentTime, 42)

    audio.duration = NaN
    assert.equal(engine.getDuration(), 0, 'A non-finite/unknown duration must read as 0')
  })

  it('setVolume applies gains between 0 and 1 and ignores invalid input', () => {
    const audio = new FakeHtmlAudioElement()
    const { engine } = createEngine(audio)

    engine.setVolume(0.35)
    assert.equal(audio.volume, 0.35)

    engine.setVolume(-0.5)
    assert.equal(audio.volume, 0, 'Negative volume must clamp to 0')

    engine.setVolume(42)
    assert.equal(audio.volume, 1, 'Volume above 1 must clamp to 1')

    engine.setVolume(Number.NaN)
    assert.equal(audio.volume, 1, 'Non-finite volume must be ignored, not applied')

    engine.setVolume(Number.POSITIVE_INFINITY)
    assert.equal(audio.volume, 1, 'Infinite volume must be ignored, not applied')
  })

  it('isEnded reflects the media element ended flag for pause-event filtering', () => {
    const audio = new FakeHtmlAudioElement()
    const { engine } = createEngine(audio)

    assert.equal(engine.isEnded(), false)
    audio.ended = true
    assert.equal(engine.isEnded(), true)
  })

  it('dispose() removes every listener, stops audio and clears the source', async () => {
    const audio = new FakeHtmlAudioElement()
    let timeCount = 0
    let playingCount = 0
    let endedCount = 0
    let errorCount = 0
    const engine = new Html5AudioEngine({
      audio: audio as unknown as HTMLAudioElement,
      events: {
        onTime: () => {
          timeCount += 1
        },
        onWaiting: () => {},
        onPlaying: () => {
          playingCount += 1
        },
        onPause: () => {},
        onEnded: () => {
          endedCount += 1
        },
        onError: () => {
          errorCount += 1
        },
      },
    })

    engine.load(makeTrack({ provider: 'orbim', playbackUrl: 'https://example.com/a.ogg' }))
    await engine.play()
    engine.clear()

    // Baseline activity before dispose (playing fired once, pause once).
    assert.ok(playingCount >= 1)

    engine.dispose()

    assert.equal(audio.listenerCount('timeupdate'), 0)
    assert.equal(audio.listenerCount('error'), 0)
    assert.equal(audio.listenerCount('playing'), 0)
    assert.equal(audio.listenerCount('ended'), 0)

    // No leaked events and no lingering media resource after dispose.
    const playingBefore = playingCount
    const endedBefore = endedCount
    const errorBefore = errorCount
    const timeBefore = timeCount
    audio.currentTime = 9
    audio.emit('timeupdate')
    audio.emit('ended')
    audio.error = { code: 2, message: 'Decode failure' }
    audio.emit('error')
    assert.equal(timeCount, timeBefore, 'No time events after dispose')
    assert.equal(playingCount, playingBefore, 'No playing events after dispose')
    assert.equal(endedCount, endedBefore, 'No ended events after dispose')
    assert.equal(errorCount, errorBefore, 'No error events after dispose')
    assert.equal(audio.src, '')
    assert.equal(audio.paused, true)
  })
})

describe('playerReducer: queue, advancement & volume behavior', () => {
  const trackA = makeTrack({
    provider: 'orbim',
    providerTrackId: 'A',
    title: 'A',
    playbackUrl: 'https://example.com/a.ogg',
    durationSeconds: 10,
  })
  const trackB = makeTrack({
    provider: 'orbim',
    providerTrackId: 'B',
    title: 'B',
    playbackUrl: undefined,
    durationSeconds: 5,
  })

  it('play() stores the queue, marks playing and reflects audio loading', () => {
    const state = playerReducer(initialState, {
      type: 'play',
      queue: [trackA],
      startIndex: 0,
      label: 'Orbim radio',
    })

    assert.equal(state.queue.length, 1)
    assert.equal(state.currentIndex, 0)
    assert.equal(state.isPlaying, true)
    assert.equal(state.isLoadingAudio, true)
    assert.equal(state.elapsedSeconds, 0)
    assert.equal(state.playbackError, null)
  })

  it('tick advances progress and track-end advances the queue', () => {
    let state = playerReducer(initialState, {
      type: 'play',
      queue: [trackA, trackB],
      startIndex: 0,
      label: null,
    })

    state = playerReducer(state, { type: 'tick' })
    assert.equal(state.elapsedSeconds, 1)

    // Jump to the last second, then tick past track end → next queue position.
    state = playerReducer(state, { type: 'setTime', seconds: 9 })
    state = playerReducer(state, { type: 'tick' })
    assert.equal(state.currentIndex, 1)
    assert.equal(state.elapsedSeconds, 0)
    assert.equal(state.isPlaying, true)
  })

  it('tick on the final track stops playback at the end instead of advancing', () => {
    let state = playerReducer(initialState, {
      type: 'play',
      queue: [trackA],
      startIndex: 0,
      label: null,
    })

    state = playerReducer(state, { type: 'setTime', seconds: 9 })
    state = playerReducer(state, { type: 'tick' })
    assert.equal(state.isPlaying, false)
    assert.equal(state.elapsedSeconds, 10, 'Progress rests at the final duration')
  })

  it('previous() re-plays the current track after 3 s and rewinds to the previous one earlier', () => {
    let state = playerReducer(initialState, {
      type: 'play',
      queue: [trackA, trackB],
      startIndex: 1,
      label: null,
    })
    assert.equal(state.currentIndex, 1)

    // elapsed > 3 → position resets to 0 but the track stays.
    state = playerReducer(state, { type: 'setTime', seconds: 5 })
    const restarted = playerReducer(state, { type: 'previous' })
    assert.equal(restarted.currentIndex, 1)
    assert.equal(restarted.elapsedSeconds, 0)
    assert.equal(restarted.isPlaying, true)

    // elapsed <= 3 → moves back to the previous track.
    const rewound = playerReducer(
      { ...restarted, currentIndex: 1, elapsedSeconds: 2 },
      { type: 'previous' },
    )
    assert.equal(rewound.currentIndex, 0)
    assert.equal(rewound.elapsedSeconds, 0)
    assert.equal(rewound.isPlaying, true)

    // Already on the first track: nothing to rewind to.
    const noop = playerReducer(
      { ...rewound, currentIndex: 0, elapsedSeconds: 2 },
      { type: 'previous' },
    )
    assert.equal(noop.currentIndex, 0)
    assert.equal(noop.isPlaying, true)
  })

  it('seek clamps to the track boundary and allows free seeking for unknown durations', () => {
    let state = playerReducer(initialState, {
      type: 'play',
      queue: [trackA], // durationSeconds: 10
      startIndex: 0,
      label: null,
    })

    state = playerReducer(state, { type: 'seek', seconds: 99 })
    assert.equal(state.elapsedSeconds, 10)

    state = playerReducer(state, { type: 'seek', seconds: -3 })
    assert.equal(state.elapsedSeconds, 0)

    const unknownDuration = playerReducer(
      { ...state, queue: [makeTrack({ providerTrackId: 'C', durationSeconds: 0 })] },
      { type: 'seek', seconds: 40 },
    )
    assert.equal(unknownDuration.elapsedSeconds, 40)
  })

  it('setDuration backfills unknown durations without touching known ones', () => {
    const trackUnknown = makeTrack({
      provider: 'orbim',
      providerTrackId: 'D',
      playbackUrl: 'https://example.com/d.ogg',
      durationSeconds: 0,
    })
    let state = playerReducer(initialState, {
      type: 'play',
      queue: [trackUnknown],
      startIndex: 0,
      label: null,
    })

    state = playerReducer(state, { type: 'setDuration', seconds: 77 })
    assert.equal(state.queue[0].durationSeconds, 77)

    const locked = playerReducer(state, { type: 'setDuration', seconds: 1 })
    assert.equal(locked.queue[0].durationSeconds, 77, 'A known duration is never overwritten')
  })

  it('clearing a playback error never stops the current playback', () => {
    const state = playerReducer(initialState, {
      type: 'play',
      queue: [trackA],
      startIndex: 0,
      label: null,
    })
    assert.equal(state.isPlaying, true)

    // Engines clear the error on every successful "playing" event, so this must
    // be a no-op for playback state instead of pausing the audio that just started.
    const cleared = playerReducer(state, { type: 'setError', error: null })
    assert.equal(cleared.isPlaying, true, 'Clearing an error must not pause playback')
    assert.equal(cleared.playbackError, null)

    const failed = playerReducer(cleared, { type: 'setError', error: 'decode failed' })
    assert.equal(failed.isPlaying, false, 'A real error still stops playback')
    assert.equal(failed.isLoadingAudio, false)
    assert.equal(failed.playbackError, 'decode failed')
  })

  it('volume clamps between 0 and 1 and stop() restores defaults', () => {
    let state = playerReducer(initialState, {
      type: 'play',
      queue: [trackA],
      startIndex: 0,
      label: null,
    })

    state = playerReducer(state, { type: 'setVolume', volume: 0.4 })
    assert.equal(state.volume, 0.4)

    state = playerReducer(state, { type: 'setVolume', volume: 9 })
    assert.equal(state.volume, 1)

    state = playerReducer(state, { type: 'setVolume', volume: -2 })
    assert.equal(state.volume, 0)

    state = playerReducer(state, { type: 'setVolume', volume: Number.NaN })
    assert.equal(state.volume, 0, 'Invalid input never corrupts volume state')

    state = playerReducer(state, { type: 'stop' })
    assert.deepEqual(state, { ...initialState, volume: 1 })
    assert.equal(state.queue.length, 0)
  })
})

describe('Spotify & Multi-Provider HTML5 Audio Routing Regressions', () => {
  it('routes Spotify metadata with a valid Supabase Storage audio URL to html5-audio', () => {
    const track = makeTrack({
      provider: 'spotify',
      providerTrackId: '2o1pb13quMReXZqE7jWsgq',
      title: 'intro (end of the world)',
      playbackUrl:
        'https://rprrvdyugakkpittzvjv.supabase.co/storage/v1/object/public/track-audio/96e20d19-6a61-4938-b765-b226e9f2ccbb/744b4c5b-8d35-49b3-8378-66d1eed81ab7.mp3',
      storagePath:
        '96e20d19-6a61-4938-b765-b226e9f2ccbb/744b4c5b-8d35-49b3-8378-66d1eed81ab7.mp3',
    })

    assert.equal(hasDirectAudioUrl(track), true)
    assert.equal(selectTrackPlayback(track), 'html5-audio')
  })

  it('routes Spotify metadata with storagePath but missing playbackUrl to html5-audio via resolveEffectiveTrack', () => {
    const rawTrack = makeTrack({
      provider: 'spotify',
      providerTrackId: '2o1pb13quMReXZqE7jWsgq',
      title: 'intro (end of the world)',
      playbackUrl: undefined,
      audioSourceUrl: undefined,
      storagePath:
        '96e20d19-6a61-4938-b765-b226e9f2ccbb/744b4c5b-8d35-49b3-8378-66d1eed81ab7.mp3',
    })

    assert.equal(hasDirectAudioUrl(rawTrack), true, 'hasDirectAudioUrl recognizes storagePath')
    assert.equal(
      selectTrackPlayback(rawTrack),
      'html5-audio',
      'selectTrackPlayback routes storagePath to html5-audio',
    )

    const effective = resolveEffectiveTrack(rawTrack)
    assert.ok(effective)
    assert.equal(effective.isPlayable, true)
    assert.ok(effective.playbackUrl?.startsWith('https://'))
    assert.equal(selectTrackPlayback(effective), 'html5-audio')
  })

  it('Spotify metadata + missing audio URL must not falsely claim HTML5 playback is available', () => {
    const metadataOnlyTrack = makeTrack({
      provider: 'spotify',
      providerTrackId: '3n3Ppam7vgaVa1iaRUc9Lp',
      title: 'Metadata Only Track',
      playbackUrl: undefined,
      audioSourceUrl: undefined,
      storagePath: undefined,
      isPlayable: false,
    })

    assert.equal(hasDirectAudioUrl(metadataOnlyTrack), false)
    assert.notEqual(selectTrackPlayback(metadataOnlyTrack), 'html5-audio')
    assert.equal(selectTrackPlayback(metadataOnlyTrack), 'spotify-sdk')
  })

  it('routes iTunes metadata with a valid Supabase Storage audio URL to html5-audio', () => {
    const itunesTrack = makeTrack({
      provider: 'itunes' as any,
      providerTrackId: 'itunes-998877',
      title: 'iTunes Sourced Track',
      playbackUrl:
        'https://rprrvdyugakkpittzvjv.supabase.co/storage/v1/object/public/track-audio/folder/track.mp3',
      storagePath: 'folder/track.mp3',
    })

    assert.equal(hasDirectAudioUrl(itunesTrack), true)
    assert.equal(selectTrackPlayback(itunesTrack), 'html5-audio')
  })

  it('correctly maps database storage_path from catalog_tracks into the effective playback track', () => {
    const catalogRecord = {
      id: 'cat-track-1',
      provider: 'spotify' as const,
      providerTrackId: '2o1pb13quMReXZqE7jWsgq',
      title: 'intro (end of the world)',
      artistName: 'Ariana Grande',
      durationSeconds: 92,
      storagePath:
        '96e20d19-6a61-4938-b765-b226e9f2ccbb/744b4c5b-8d35-49b3-8378-66d1eed81ab7.mp3',
      audioUrl: null,
      audioSourceType: 'storage' as const,
      publicationStatus: 'published' as const,
      createdAt: '2026-11-01T08:53:41.000Z',
      updatedAt: '2026-11-01T08:53:41.000Z',
    }

    const mapped = mapCatalogRecordToMusicTrack(catalogRecord)
    assert.equal(mapped.isPlayable, true)
    assert.ok(mapped.playbackUrl, 'playbackUrl must be populated from storagePath')
    assert.ok(
      mapped.playbackUrl.includes(
        '96e20d19-6a61-4938-b765-b226e9f2ccbb/744b4c5b-8d35-49b3-8378-66d1eed81ab7.mp3',
      ),
    )
    assert.equal(selectTrackPlayback(mapped), 'html5-audio')
  })

  it('correctly maps database storage_path from playlist_tracks into the effective playback track', () => {
    const playlistRow = {
      id: 'pt-1',
      playlist_id: 'pl-1',
      provider: 'spotify',
      provider_track_id: '7CyPwkp0oE8Ro9Dd5CUDjW',
      title: 'One Of The Girls',
      artist_name: 'The Weeknd',
      duration_seconds: 245,
      storage_path:
        '96e20d19-6a61-4938-b765-b226e9f2ccbb/09b3f922-27c3-47f8-be9b-129bf6a05356.mp3',
      audio_url: null,
      audio_source_type: 'storage',
      position: 1,
      added_at: '2026-10-31T09:47:05.000Z',
      added_by: 'user-1',
    }

    const mapped = mapPlaylistTrackRow(playlistRow as any)
    assert.equal(mapped.isPlayable, true)
    assert.ok(mapped.playbackUrl, 'playbackUrl must be derived from storage_path')
    assert.ok(mapped.playbackUrl.includes('09b3f922-27c3-47f8-be9b-129bf6a05356.mp3'))
    assert.equal(selectTrackPlayback(mapped), 'html5-audio')
  })

  it('guarantees resolveStoragePublicUrl produces canonical Supabase CDN URLs from paths', () => {
    const cdnUrl = resolveStoragePublicUrl('folder-uuid/file.mp3', 'track-audio')
    assert.ok(cdnUrl)
    assert.ok(cdnUrl.endsWith('/storage/v1/object/public/track-audio/folder-uuid/file.mp3'))
  })

  it('guarantees Spotify SDK authorization failure does not affect tracks with Supabase Storage audio', () => {
    // When a track has Supabase Storage audio, selection is html5-audio.
    // Provider sync effect returns immediately and never checks isSpotifyPlaybackAuthorized.
    const storageTrack = makeTrack({
      provider: 'spotify',
      providerTrackId: '2o1pb13quMReXZqE7jWsgq',
      title: 'intro (end of the world)',
      playbackUrl:
        'https://rprrvdyugakkpittzvjv.supabase.co/storage/v1/object/public/track-audio/96e20d19-6a61-4938-b765-b226e9f2ccbb/744b4c5b-8d35-49b3-8378-66d1eed81ab7.mp3',
      storagePath:
        '96e20d19-6a61-4938-b765-b226e9f2ccbb/744b4c5b-8d35-49b3-8378-66d1eed81ab7.mp3',
    })

    const selection = selectTrackPlayback(storageTrack)
    assert.equal(selection, 'html5-audio')
    assert.notEqual(selection, 'spotify-sdk')
  })
})
