import type { MusicTrack } from '../../types/music.ts'
import {
  DEFAULT_PLAYBACK_MODE,
  type PlaybackMode,
} from './playback-modes.ts'

/**
 * Pure reducer for ORBIM's shared player state.
 *
 * Kept in its own module so PlayerProvider stays a components-file-express
 * fast-refresh boundary. It owns queue advancement boundaries, repeat/shuffle
 * mode transitions, timer-fallback progression, and volume clamping — engines
 * never mutate this state; they report and PlayerProvider dispatches.
 *
 * `queue` is the order playback actually follows. `originalQueue` is the
 * untouched source order (playlist or search results) so leaving a shuffle mode
 * can restore it. Smart Shuffle recommendations live only in `queue`.
 */

export type PlayerState = {
  queue: MusicTrack[]
  /** Source order, independent of shuffle/smart-shuffle reordering. */
  originalQueue: MusicTrack[]
  /** Single authoritative playback mode — never a set of booleans. */
  mode: PlaybackMode
  currentIndex: number
  queueLabel: string | null
  isPlaying: boolean
  elapsedSeconds: number
  /** Player volume, clamped between 0 and 1. Default 1 (no attenuation). */
  volume: number
  playbackError: string | null
  isLoadingAudio: boolean
}

export type PlayerAction =
  | {
      type: 'play'
      queue: MusicTrack[]
      /** Untouched source order; defaults to the queue itself. */
      originalQueue?: MusicTrack[]
      startIndex: number
      label: string | null
    }
  | {
      type: 'setMode'
      mode: PlaybackMode
      /** Reordered queue produced by the mode helpers. Omit to keep it. */
      queue?: MusicTrack[]
      currentIndex?: number
      originalQueue?: MusicTrack[]
    }
  | { type: 'toggle' }
  | { type: 'setPlaying'; isPlaying: boolean }
  /** Audio reached the end of the current track (engines report this). */
  | { type: 'ended' }
  | { type: 'tick' }
  | { type: 'setTime'; seconds: number }
  | { type: 'setDuration'; seconds: number }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; seconds: number }
  | { type: 'setVolume'; volume: number }
  | { type: 'setError'; error: string | null }
  | { type: 'setLoadingAudio'; isLoading: boolean }
  | { type: 'stop' }

export const DEFAULT_VOLUME = 1

function clampVolume(volume: number): number {
  return Math.min(Math.max(volume, 0), 1)
}

function clampIndex(index: number, length: number): number {
  if (length === 0) return -1
  return Math.min(Math.max(index, 0), length - 1)
}

export function createInitialState(mode: PlaybackMode = DEFAULT_PLAYBACK_MODE): PlayerState {
  return {
    queue: [],
    originalQueue: [],
    mode,
    currentIndex: -1,
    queueLabel: null,
    isPlaying: false,
    elapsedSeconds: 0,
    volume: DEFAULT_VOLUME,
    playbackError: null,
    isLoadingAudio: false,
  }
}

export const initialState: PlayerState = createInitialState()

function currentTrackOf(state: PlayerState): MusicTrack | null {
  return state.currentIndex >= 0 ? (state.queue[state.currentIndex] ?? null) : null
}

/** Moves playback to `index`, resetting progress for the new track. */
function moveToIndex(state: PlayerState, index: number, isPlaying: boolean): PlayerState {
  const nextTrack = state.queue[index] ?? null

  return {
    ...state,
    currentIndex: clampIndex(index, state.queue.length),
    elapsedSeconds: 0,
    isPlaying,
    playbackError: null,
    isLoadingAudio: Boolean(nextTrack?.playbackUrl),
  }
}

/**
 * Advances one track. Either wraps (`repeat-all`), advances, or stops at the end
 * of the queue. Manual next and automatic end-of-track share this rule, except
 * that `repeat-one` only affects the automatic case.
 */
function advance(state: PlayerState, options: { allowRepeatAll: boolean }): PlayerState {
  if (state.currentIndex + 1 < state.queue.length) {
    return moveToIndex(state, state.currentIndex + 1, true)
  }

  if (options.allowRepeatAll && state.mode === 'repeat-all') {
    return moveToIndex(state, 0, true)
  }

  return { ...state, isPlaying: false }
}

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  const track = currentTrackOf(state)

  switch (action.type) {
    case 'play': {
      const activeTrack = action.queue[action.startIndex]
      return {
        ...state,
        queue: action.queue,
        originalQueue: action.originalQueue ?? action.queue,
        currentIndex: clampIndex(action.startIndex, action.queue.length),
        queueLabel: action.label,
        isPlaying: true,
        elapsedSeconds: 0,
        playbackError: null,
        isLoadingAudio: Boolean(activeTrack?.playbackUrl),
      }
    }

    case 'setMode': {
      const queue = action.queue ?? state.queue
      const originalQueue = action.originalQueue ?? state.originalQueue

      return {
        ...state,
        mode: action.mode,
        queue,
        originalQueue,
        // Reordering never interrupts the track that is currently playing.
        currentIndex: action.queue
          ? clampIndex(action.currentIndex ?? 0, queue.length)
          : clampIndex(state.currentIndex, queue.length),
      }
    }

    case 'setPlaying':
      return { ...state, isPlaying: action.isPlaying }

    case 'toggle': {
      if (!track) return state

      if (!state.isPlaying && track.durationSeconds > 0 && state.elapsedSeconds >= track.durationSeconds) {
        return { ...state, isPlaying: true, elapsedSeconds: 0, playbackError: null }
      }

      return { ...state, isPlaying: !state.isPlaying, playbackError: null }
    }

    case 'setTime':
      return { ...state, elapsedSeconds: action.seconds }

    case 'setDuration': {
      if (!track || track.durationSeconds > 0) return state
      const updatedQueue = [...state.queue]
      updatedQueue[state.currentIndex] = {
        ...track,
        durationSeconds: action.seconds,
      }
      return { ...state, queue: updatedQueue }
    }

    case 'ended': {
      if (!track) return { ...state, isPlaying: false }

      if (state.mode === 'repeat-one') {
        return { ...state, elapsedSeconds: 0, isPlaying: true, playbackError: null }
      }

      return advance(state, { allowRepeatAll: true })
    }

    case 'tick': {
      if (!track || !state.isPlaying) return state

      const nextElapsed = state.elapsedSeconds + 1

      if (track.durationSeconds > 0 && nextElapsed < track.durationSeconds) {
        return { ...state, elapsedSeconds: nextElapsed }
      }

      if (track.durationSeconds > 0 && nextElapsed >= track.durationSeconds) {
        if (state.mode === 'repeat-one') {
          return { ...state, elapsedSeconds: 0 }
        }

        if (state.currentIndex + 1 < state.queue.length) {
          return moveToIndex(state, state.currentIndex + 1, true)
        }

        if (state.mode === 'repeat-all') {
          return moveToIndex(state, 0, true)
        }

        return { ...state, elapsedSeconds: track.durationSeconds, isPlaying: false }
      }

      return { ...state, elapsedSeconds: nextElapsed }
    }

    case 'next': {
      if (!track) return { ...state, isPlaying: false }
      return advance(state, { allowRepeatAll: true })
    }

    case 'previous': {
      if (!track) return state

      if (state.elapsedSeconds > 3) {
        return { ...state, elapsedSeconds: 0, playbackError: null }
      }

      if (state.currentIndex === 0) {
        if (state.mode !== 'repeat-all' || state.queue.length <= 1) return state
        return moveToIndex(state, state.queue.length - 1, true)
      }

      return moveToIndex(state, state.currentIndex - 1, true)
    }

    case 'seek': {
      if (!track) return state
      const maxSeconds = track.durationSeconds > 0 ? track.durationSeconds : Number.MAX_SAFE_INTEGER
      const clamped = Math.min(Math.max(action.seconds, 0), maxSeconds)
      return { ...state, elapsedSeconds: clamped }
    }

    case 'setVolume':
      return Number.isFinite(action.volume)
        ? { ...state, volume: clampVolume(action.volume) }
        : state

    case 'setError':
      // Clearing an error must never touch playback: engines clear it on every
      // successful "playing" event, so forcing isPlaying=false here paused the
      // audio the instant it started. Only a real error stops playback.
      if (action.error === null) {
        return { ...state, playbackError: null }
      }

      return { ...state, playbackError: action.error, isPlaying: false, isLoadingAudio: false }

    case 'setLoadingAudio':
      return { ...state, isLoadingAudio: action.isLoading }

    case 'stop':
      return createInitialState(state.mode)
  }
}
