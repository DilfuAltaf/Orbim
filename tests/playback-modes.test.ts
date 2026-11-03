import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildShuffleQueue,
  buildSmartShuffleQueue,
  cycleRepeatMode,
  cycleShuffleMode,
  isShuffleMode,
  readStoredPlaybackMode,
  repeatModeOf,
  restoreOriginalQueue,
  writeStoredPlaybackMode,
} from '../src/features/player/playback-modes.ts'
import {
  createInitialState,
  playerReducer,
  type PlayerState,
} from '../src/features/player/player-reducer.ts'
import type { MusicTrack } from '../src/types/music.ts'

/**
 * Advanced playback-mode coverage: ordered playback, repeat off/all/one, shuffle
 * without premature duplicates, restoring the original queue, and Smart Shuffle
 * recommendation rules.
 */

let trackSequence = 0

function makeTrack(overrides: Partial<MusicTrack> & { title: string }): MusicTrack {
  trackSequence += 1

  return {
    provider: 'orbim',
    providerTrackId: `catalog-${trackSequence}`,
    artistName: 'ORBIM Artist',
    durationSeconds: 200,
    genre: 'Pop',
    moods: [],
    isPlayable: true,
    playbackUrl: `https://cdn.example.test/orbim/${trackSequence}.mp3`,
    publicationStatus: 'published',
    ...overrides,
  }
}

const queue = ['A', 'B', 'C', 'D', 'E'].map((title) => makeTrack({ title }))

function titleOf(state: PlayerState): string | null {
  return state.currentIndex >= 0 ? (state.queue[state.currentIndex]?.title ?? null) : null
}

function playQueue(
  tracks: MusicTrack[],
  options: { startIndex?: number; mode?: PlayerState['mode'] } = {},
): PlayerState {
  const { startIndex = 0, mode = 'off' } = options

  return playerReducer(createInitialState(mode), {
    type: 'play',
    queue: tracks,
    startIndex,
    label: 'Test playlist',
  })
}

/** Deterministic PRNG so shuffle assertions never depend on timing. */
function seededRandom(seed = 42): () => number {
  let value = seed

  return () => {
    value = (value * 1103515245 + 12345) % 2147483648
    return value / 2147483648
  }
}

function withMode(state: PlayerState, mode: PlayerState['mode']): PlayerState {
  return playerReducer(state, { type: 'setMode', mode })
}

describe('Advanced playback modes', () => {
  describe('Sequential / ordered playback', () => {
    it('follows the playlist order for next, previous and track end', () => {
      let state = playQueue(queue)

      assert.equal(titleOf(state), 'A')

      state = playerReducer(state, { type: 'ended' })
      assert.equal(titleOf(state), 'B')

      state = playerReducer(state, { type: 'next' })
      assert.equal(titleOf(state), 'C')

      state = playerReducer(state, { type: 'previous' })
      assert.equal(titleOf(state), 'B')

      state = playerReducer(state, { type: 'next' })
      state = playerReducer(state, { type: 'next' })
      assert.equal(titleOf(state), 'D')

      assert.deepEqual(
        state.queue.map((track) => track.title),
        ['A', 'B', 'C', 'D', 'E'],
      )
    })

    it('records the untouched playlist as the original queue', () => {
      const state = playQueue(queue, { startIndex: 2 })

      assert.equal(titleOf(state), 'C')
      assert.deepEqual(
        state.originalQueue.map((track) => track.title),
        ['A', 'B', 'C', 'D', 'E'],
      )
    })
  })

  describe('Repeat off', () => {
    it('stops at the end of the queue instead of restarting', () => {
      let state = playQueue(queue, { startIndex: 4 })

      state = playerReducer(state, { type: 'ended' })

      assert.equal(titleOf(state), 'E')
      assert.equal(state.isPlaying, false)
    })

    it('does not wrap when going to the previous track from the first entry', () => {
      let state = playQueue(queue)
      state = playerReducer(state, { type: 'ended' })
      state = playerReducer(state, { type: 'previous' })
      state = playerReducer(state, { type: 'previous' })

      assert.equal(titleOf(state), 'A')
    })
  })

  describe('Repeat all', () => {
    it('returns to the first queue entry after the final track', () => {
      let state = withMode(playQueue(queue, { startIndex: 4 }), 'repeat-all')

      state = playerReducer(state, { type: 'ended' })

      assert.equal(titleOf(state), 'A')
      assert.equal(state.isPlaying, true)
      assert.equal(state.currentIndex, 0)
    })

    it('preserves queue ordering while wrapping', () => {
      let state = withMode(playQueue(queue, { startIndex: 4 }), 'repeat-all')
      state = playerReducer(state, { type: 'ended' })

      assert.deepEqual(
        state.originalQueue.map((track) => track.title),
        ['A', 'B', 'C', 'D', 'E'],
      )
      assert.equal(titleOf(playerReducer(state, { type: 'next' })), 'B')
    })

    it('wraps backwards to the last track from the first entry', () => {
      let state = withMode(playQueue(queue, { startIndex: 0 }), 'repeat-all')
      state = playerReducer(state, { type: 'previous' })

      assert.equal(titleOf(state), 'E')
    })
  })

  describe('Repeat one', () => {
    it('replays the current track instead of advancing when it ends', () => {
      let state = withMode(playQueue(queue, { startIndex: 1 }), 'repeat-one')
      state = playerReducer(state, { type: 'setTime', seconds: 199 })

      state = playerReducer(state, { type: 'ended' })

      assert.equal(titleOf(state), 'B')
      assert.equal(state.isPlaying, true)
      assert.equal(state.elapsedSeconds, 0)
    })

    it('still allows manually moving to the next track', () => {
      const state = withMode(playQueue(queue, { startIndex: 1 }), 'repeat-one')

      assert.equal(titleOf(playerReducer(state, { type: 'next' })), 'C')
    })
  })

  describe('Shuffle', () => {
    it('keeps the current track first and every track exactly once', () => {
      const { queue: shuffledQueue, currentIndex } = buildShuffleQueue({
        queue,
        currentTrack: queue[2],
        random: seededRandom(),
      })

      assert.equal(currentIndex, 0)
      assert.equal(shuffledQueue[0].title, 'C')
      assert.equal(shuffledQueue.length, queue.length)
      assert.deepEqual(
        new Set(shuffledQueue.map((track) => track.providerTrackId)),
        new Set(queue.map((track) => track.providerTrackId)),
      )
    })

    it('plays every queued track once before repeating (repeat off)', () => {
      const shuffled = buildShuffleQueue({
        queue,
        currentTrack: queue[0],
        random: seededRandom(7),
      })

      let state = playQueue(shuffled.queue, {
        startIndex: shuffled.currentIndex,
        mode: 'shuffle',
      })

      const played = [titleOf(state)]

      for (let index = 0; index < shuffled.queue.length - 1; index += 1) {
        state = playerReducer(state, { type: 'ended' })
        played.push(titleOf(state))
      }

      assert.equal(played.length, queue.length)
      assert.equal(new Set(played).size, queue.length)

      const finished = playerReducer(state, { type: 'ended' })
      assert.equal(finished.isPlaying, false)
    })

    it('restores the original order when shuffle is disabled', () => {
      const shuffled = buildShuffleQueue({
        queue,
        currentTrack: queue[0],
        random: seededRandom(11),
      })
      const playingTrack = shuffled.queue[2]

      const restored = restoreOriginalQueue({
        originalQueue: queue,
        currentTrack: playingTrack,
        queue: shuffled.queue,
      })

      assert.deepEqual(
        restored.queue.map((track) => track.title),
        ['A', 'B', 'C', 'D', 'E'],
      )
      assert.equal(restored.queue[restored.currentIndex].title, playingTrack.title)
    })

    it('treats shuffle and smart shuffle as the same reorder family', () => {
      assert.equal(isShuffleMode('shuffle'), true)
      assert.equal(isShuffleMode('smart-shuffle'), true)
      assert.equal(isShuffleMode('repeat-one'), false)
    })
  })

  describe('Smart Shuffle', () => {
    const base = [
      makeTrack({ title: 'Base one', genre: 'Indie Pop', artistName: 'Nova' }),
      makeTrack({ title: 'Base two', genre: 'Indie Pop', artistName: 'Nova' }),
    ]

    const eligibleRecommendation = makeTrack({
      title: 'Catalog match',
      genre: 'Indie Pop',
      artistName: 'Nova',
      storagePath: 'catalog/audio/catalog-match.mp3',
    })
    const draftTrack = makeTrack({ title: 'Draft track', publicationStatus: 'draft' })
    const unpublishedTrack = makeTrack({ title: 'Unpublished track', publicationStatus: 'unpublished' })
    const metadataOnlyTrack = makeTrack({
      title: 'Metadata only',
      isPlayable: false,
      playbackUrl: undefined,
    })
    const unplayableTrack = makeTrack({
      title: 'Unplayable',
      isPlayable: false,
      playbackUrl: undefined,
      storagePath: 'catalog/audio/unplayable.mp3',
    })
    const duplicateOfBase = makeTrack({
      title: 'Base one',
      providerTrackId: base[0].providerTrackId,
    })

    const candidates = [
      eligibleRecommendation,
      draftTrack,
      unpublishedTrack,
      metadataOnlyTrack,
      unplayableTrack,
      duplicateOfBase,
    ]

    it('adds only published, playable catalog tracks', () => {
      const { queue: smartQueue } = buildSmartShuffleQueue({
        base,
        recommendations: candidates,
        currentTrack: base[0],
        random: seededRandom(3),
      })

      assert.ok(smartQueue.indexOf(base[0]) >= 0)
      assert.ok(smartQueue.indexOf(base[1]) >= 0)
      assert.ok(smartQueue.some((track) => track.title === 'Catalog match'))

      for (const title of ['Draft track', 'Unpublished track', 'Metadata only', 'Unplayable']) {
        assert.equal(
          smartQueue.some((track) => track.title === title),
          false,
          `${title} must never be recommended`,
        )
      }

      for (const recommendation of smartQueue.filter((track) => track.isRecommendation)) {
        assert.equal(recommendation.publicationStatus, 'published')
        assert.equal(recommendation.isPlayable, true)
        assert.ok(
          Boolean(recommendation.storagePath) || Boolean(recommendation.playbackUrl),
          'recommendations need a real audio source',
        )
      }
    })

    it('distinguishes recommended tracks from playlist tracks', () => {
      const { queue: smartQueue } = buildSmartShuffleQueue({
        base,
        recommendations: candidates,
        currentTrack: base[0],
        random: seededRandom(5),
      })

      const recommended = smartQueue.filter((track) => track.isRecommendation)
      const original = smartQueue.filter((track) => !track.isRecommendation)

      assert.equal(recommended.length, 1)
      assert.equal(original.length, base.length)
    })

    it('never duplicates a track already in the playlist', () => {
      const { queue: smartQueue } = buildSmartShuffleQueue({
        base,
        recommendations: candidates,
        currentTrack: base[0],
        random: seededRandom(9),
      })

      assert.equal(
        new Set(smartQueue.map((track) => track.providerTrackId)).size,
        smartQueue.length,
      )
    })

    it('does not modify the saved playlist membership', () => {
      const savedPlaylist = [...base]
      const snapshot = savedPlaylist.map((track) => track.providerTrackId)

      buildSmartShuffleQueue({
        base: savedPlaylist,
        recommendations: candidates,
        currentTrack: savedPlaylist[0],
        random: seededRandom(13),
      })

      assert.deepEqual(
        savedPlaylist.map((track) => track.providerTrackId),
        snapshot,
      )
      assert.equal(savedPlaylist.some((track) => track.isRecommendation), false)
    })

    it('works with a small playlist', () => {
      const single = [makeTrack({ title: 'Only track', genre: 'Indie Pop', artistName: 'Nova' })]

      const { queue: smartQueue, currentIndex } = buildSmartShuffleQueue({
        base: single,
        recommendations: [eligibleRecommendation],
        currentTrack: single[0],
        random: seededRandom(17),
      })

      assert.equal(currentIndex, 0)
      assert.equal(smartQueue[0].title, 'Only track')
      assert.ok(smartQueue.some((track) => track.isRecommendation))
    })

    it('keeps a recommendation audible when shuffle is disabled', () => {
      const recommendation = { ...eligibleRecommendation, isRecommendation: true }

      const restored = restoreOriginalQueue({
        originalQueue: base,
        currentTrack: recommendation,
        queue: [base[0], recommendation, base[1]],
      })

      assert.equal(restored.queue[restored.currentIndex].title, 'Catalog match')
      assert.deepEqual(restored.queue.slice(1).map((track) => track.title), ['Base one', 'Base two'])
    })
  })

  describe('Mode state model', () => {
    it('keeps repeat and shuffle mutually exclusive while cycling', () => {
      const repeatChain = [
        cycleRepeatMode('off'),
        cycleRepeatMode('repeat-all'),
        cycleRepeatMode('repeat-one'),
      ]

      assert.deepEqual(repeatChain, ['repeat-all', 'repeat-one', 'off'])
      assert.equal(cycleRepeatMode('off'), 'repeat-all')
      assert.equal(cycleShuffleMode('off'), 'shuffle')
      assert.equal(cycleShuffleMode('shuffle'), 'smart-shuffle')
      assert.equal(cycleShuffleMode('smart-shuffle'), 'off')

      // Enabling a shuffle mode from repeat deliberately drops repeat.
      assert.equal(repeatModeOf(cycleShuffleMode('repeat-one')), 'off')
      assert.equal(isShuffleMode(cycleRepeatMode('smart-shuffle')), false)

      // A single mode value can never describe both at once.
      for (const mode of ['off', 'repeat-all', 'repeat-one', 'shuffle', 'smart-shuffle'] as const) {
        assert.equal(isShuffleMode(mode) && repeatModeOf(mode) !== 'off', false)
      }
    })

    it('persists the preference locally without touching the database', () => {
      assert.equal(readStoredPlaybackMode(), 'off')
      assert.doesNotThrow(() => writeStoredPlaybackMode('repeat-one'))
    })
  })
})
