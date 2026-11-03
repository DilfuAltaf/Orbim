import type { MusicTrack } from '../../types/music.ts'
import { hasDirectAudioUrl } from './playback-engine.ts'

/**
 * Playback mode model.
 *
 * ORBIM keeps ONE authoritative playback mode instead of independent
 * `isShuffle`/`isRepeat` booleans, so contradictory combinations (repeat-one +
 * shuffle, repeat-all + smart-shuffle, …) cannot exist. Choosing a shuffle mode
 * clears repeat, and choosing a repeat mode clears shuffle; the UI reflects the
 * single value and every queue decision reads it from the player reducer.
 */
export type PlaybackMode = 'off' | 'repeat-all' | 'repeat-one' | 'shuffle' | 'smart-shuffle'

export type RepeatMode = 'off' | 'repeat-all' | 'repeat-one'

export const PLAYBACK_MODES: readonly PlaybackMode[] = [
  'off',
  'repeat-all',
  'repeat-one',
  'shuffle',
  'smart-shuffle',
]

export const DEFAULT_PLAYBACK_MODE: PlaybackMode = 'off'

export const PLAYBACK_MODE_STORAGE_KEY = 'orbim_playback_mode'

/** Max recommendation slots Smart Shuffle may add to a queue. */
export const SMART_SHUFFLE_MAX_RECOMMENDATIONS = 10

export function isPlaybackMode(value: unknown): value is PlaybackMode {
  return typeof value === 'string' && (PLAYBACK_MODES as readonly string[]).includes(value)
}

/** Whether the mode reorders the queue instead of following playlist order. */
export function isShuffleMode(mode: PlaybackMode): boolean {
  return mode === 'shuffle' || mode === 'smart-shuffle'
}

/** Repeat behaviour implied by the single mode value. */
export function repeatModeOf(mode: PlaybackMode): RepeatMode {
  if (mode === 'repeat-all') return 'repeat-all'
  if (mode === 'repeat-one') return 'repeat-one'
  return 'off'
}

/** Repeat button cycle: off → repeat-all → repeat-one → off. */
export function cycleRepeatMode(mode: PlaybackMode): PlaybackMode {
  switch (mode) {
    case 'off':
      return 'repeat-all'
    case 'repeat-all':
      return 'repeat-one'
    case 'repeat-one':
      return 'off'
    default:
      // Shuffle modes never carry repeat, so the first press starts repeat-all.
      return 'repeat-all'
  }
}

/** Shuffle button cycle: off → shuffle → smart-shuffle → off. */
export function cycleShuffleMode(mode: PlaybackMode): PlaybackMode {
  switch (mode) {
    case 'off':
      return 'shuffle'
    case 'shuffle':
      return 'smart-shuffle'
    case 'smart-shuffle':
      return 'off'
    default:
      // Repeat modes never carry shuffle, so the first press enables shuffle.
      return 'shuffle'
  }
}

/** Stable identity for a track inside a queue. */
export function trackQueueKey(track: Pick<MusicTrack, 'provider' | 'providerTrackId' | 'title'>): string {
  return `${track.provider}:${track.providerTrackId || track.title}`
}

export function isSameQueuedTrack(a: MusicTrack | null, b: MusicTrack | null): boolean {
  if (!a || !b) return false
  if (a.id && b.id && a.id === b.id) return true
  return trackQueueKey(a) === trackQueueKey(b)
}

/** Fisher–Yates shuffle over a copy. `random` is injectable for tests. */
export function shuffleTracks(
  tracks: MusicTrack[],
  random: () => number = Math.random,
): MusicTrack[] {
  const shuffled = [...tracks]

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const current = shuffled[index]
    shuffled[index] = shuffled[swapIndex]
    shuffled[swapIndex] = current
  }

  return shuffled
}

export interface QueueWithIndex {
  queue: MusicTrack[]
  currentIndex: number
}

/**
 * Shuffles a queue while keeping the current track playing at position 1.
 *
 * Every track appears exactly once, so a shuffle pass never repeats a track
 * before the rest of the queue has played. Returns index -1 for an empty queue.
 */
export function buildShuffleQueue(params: {
  queue: MusicTrack[]
  currentTrack?: MusicTrack | null
  random?: () => number
}): QueueWithIndex {
  const { queue, currentTrack = null, random = Math.random } = params

  if (queue.length === 0) {
    return { queue: [], currentIndex: -1 }
  }

  const currentIndex = currentTrack
    ? queue.findIndex((track) => isSameQueuedTrack(track, currentTrack))
    : -1

  if (currentIndex === -1) {
    return { queue: shuffleTracks(queue, random), currentIndex: 0 }
  }

  const current = queue[currentIndex]
  const rest = queue.filter((_, index) => index !== currentIndex)

  return { queue: [current, ...shuffleTracks(rest, random)], currentIndex: 0 }
}

/**
 * Restores the untouched playlist order, keeping the current track audible.
 *
 * A Smart Shuffle recommendation is not part of the saved playlist, so it stays
 * at the front of the restored queue until it ends instead of being dropped
 * mid-playback. The saved playlist itself is never modified.
 */
export function restoreOriginalQueue(params: {
  originalQueue: MusicTrack[]
  currentTrack?: MusicTrack | null
  queue?: MusicTrack[]
}): QueueWithIndex {
  const { originalQueue, currentTrack = null, queue = [] } = params

  if (originalQueue.length === 0) {
    return { queue: [...queue], currentIndex: currentTrack ? 0 : -1 }
  }

  const index = currentTrack
    ? originalQueue.findIndex((track) => isSameQueuedTrack(track, currentTrack))
    : -1

  if (index >= 0) {
    return { queue: [...originalQueue], currentIndex: index }
  }

  if (currentTrack) {
    return { queue: [currentTrack, ...originalQueue], currentIndex: 0 }
  }

  return { queue: [...originalQueue], currentIndex: 0 }
}

/**
 * A track may only be recommended into a Smart Shuffle queue when it is
 * published, actually playable, and carries a real audio source. Drafts,
 * unpublished records, metadata-only search results and failed uploads never
 * qualify.
 */
export function isRecommendableTrack(track: MusicTrack): boolean {
  if (track.publicationStatus && track.publicationStatus !== 'published') return false
  if (!track.isPlayable) return false
  if (!hasDirectAudioUrl(track)) return false
  return true
}

/**
 * Filters and de-duplicates catalog candidates against the current queue, so a
 * recommendation never duplicates a track the user already has.
 */
export function filterRecommendationCandidates(
  candidates: MusicTrack[],
  existing: MusicTrack[],
): MusicTrack[] {
  const seen = new Set(existing.map((track) => trackQueueKey(track)))
  const filtered: MusicTrack[] = []

  for (const candidate of candidates) {
    if (!isRecommendableTrack(candidate)) continue
    const key = trackQueueKey(candidate)
    if (seen.has(key)) continue
    seen.add(key)
    filtered.push(candidate)
  }

  return filtered
}

function recommendationScore(candidate: MusicTrack, base: MusicTrack[]): number {
  let score = 0

  for (const track of base) {
    if (track.genre && candidate.genre && track.genre === candidate.genre) score += 3
    if (
      track.artistName &&
      candidate.artistName &&
      track.artistName.toLowerCase() === candidate.artistName.toLowerCase()
    ) {
      score += 4
    }
    const sharedMoods = (candidate.moods || []).filter((mood) => (track.moods || []).includes(mood))
    score += sharedMoods.length
  }

  return score
}

/**
 * Picks relevant catalog recommendations using available metadata (artist,
 * genre, moods). Ties keep catalog order, which is newest-published first.
 */
export function selectRecommendations(
  base: MusicTrack[],
  candidates: MusicTrack[],
  options: { limit?: number } = {},
): MusicTrack[] {
  const { limit } = options
  const eligible = filterRecommendationCandidates(candidates, base)
  const max =
    limit ??
    Math.min(
      SMART_SHUFFLE_MAX_RECOMMENDATIONS,
      Math.max(3, Math.ceil(base.length / 2)),
    )

  return eligible
    .map((track, index) => ({ track, index, score: recommendationScore(track, base) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, Math.max(0, max))
    .map((entry) => ({ ...entry.track, isRecommendation: true }))
}

/**
 * Builds the Smart Shuffle queue: the user's own tracks (shuffled, current one
 * first, all preserved) with relevant published catalog tracks interleaved and
 * flagged as recommendations. The saved playlist is never mutated — the caller
 * passes a copy and receives a new array.
 */
export function buildSmartShuffleQueue(params: {
  base: MusicTrack[]
  recommendations: MusicTrack[]
  currentTrack?: MusicTrack | null
  random?: () => number
}): QueueWithIndex {
  const { base, recommendations, currentTrack = null, random = Math.random } = params

  const shuffled = buildShuffleQueue({ queue: base, currentTrack, random })
  const picked = selectRecommendations(base, recommendations)

  if (picked.length === 0 || shuffled.queue.length === 0) {
    return shuffled
  }

  const spacing = Math.max(1, Math.floor(shuffled.queue.length / (picked.length + 1)))
  const mixed: MusicTrack[] = []
  let recommendationIndex = 0

  shuffled.queue.forEach((track, index) => {
    mixed.push(track)

    const isLast = index === shuffled.queue.length - 1
    const shouldInsert =
      recommendationIndex < picked.length &&
      (isLast || (index + 1) % spacing === 0)

    if (shouldInsert && !isLast) {
      mixed.push(picked[recommendationIndex])
      recommendationIndex += 1
    }
  })

  // Remaining recommendations land after the last original track, still inside
  // the same queue and still flagged as recommendations.
  while (recommendationIndex < picked.length) {
    mixed.push(picked[recommendationIndex])
    recommendationIndex += 1
  }

  return { queue: mixed, currentIndex: shuffled.currentIndex }
}

/** Human-readable mode label for player status text. */
export function playbackModeLabel(mode: PlaybackMode): string {
  switch (mode) {
    case 'repeat-all':
      return 'repeat all'
    case 'repeat-one':
      return 'repeat 1'
    case 'shuffle':
      return 'shuffled'
    case 'smart-shuffle':
      return 'smart shuffle'
    default:
      return ''
  }
}

/** Reads the persisted preference, tolerating missing/blocked storage. */
export function readStoredPlaybackMode(): PlaybackMode {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return DEFAULT_PLAYBACK_MODE
  }

  try {
    const stored = window.localStorage.getItem(PLAYBACK_MODE_STORAGE_KEY)
    return isPlaybackMode(stored) ? stored : DEFAULT_PLAYBACK_MODE
  } catch {
    return DEFAULT_PLAYBACK_MODE
  }
}

/** Persists the preference locally; the database is not involved. */
export function writeStoredPlaybackMode(mode: PlaybackMode): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return

  try {
    window.localStorage.setItem(PLAYBACK_MODE_STORAGE_KEY, mode)
  } catch {
    // Ignore quota / private-mode restrictions.
  }
}
