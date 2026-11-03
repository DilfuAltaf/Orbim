import type { MusicTrack } from '../../types/music.ts'

/**
 * Playback engine contract.
 *
 * The ORBIM player plays audio through swappable engines while PlayerProvider
 * stays the single owner of the queue and shared context. P1 shipped the
 * HTML5 audio engine and the simulated timer fallback for demo fixtures.
 * P2 adds the Spotify Web Playback SDK engine: it is selected only for Spotify
 * tracks that carry a valid Spotify track id, and it never routes metadata-only
 * Spotify tracks through HTML5 audio or the timer fallback.
 */

/** Concrete engine identities that implement the PlaybackEngine contract. */
export type PlaybackEngineId = 'html5-audio' | 'spotify-sdk'

/** Identities a track may map to when playback starts. */
export type PlaybackEngineSelection = PlaybackEngineId | 'timer-fallback' | 'unsupported'

/**
 * Report-only events an engine can raise. PlayerProvider maps them onto its
 * reducer; engines never mutate player state directly.
 */
export interface PlaybackEngineEvents {
  /** Elapsed playback position, roughly once per second while audio runs. */
  onTime: (seconds: number) => void
  /** Audio is buffering/network-waiting and the UI should show a spinner. */
  onWaiting: () => void
  /** Audio actually started playing (user gesture respected, no autoplay error). */
  onPlaying: () => void
  /** Audio paused through the element (not track end). */
  onPause: () => void
  /** The loaded track finished playing; the provider advances the queue. */
  onEnded: () => void
  /** Loading/decoding/stream failure detail — plain text, never a token or URL. */
  onError: (detail: string) => void
}

/**
 * Contract every playback engine implements. Operations are limited to what
 * the current player genuinely performs: load/play/pause/seek/state/volume
 * and final cleanup. Keep it small — P2 adds a Spotify engine, not a framework.
 */
export interface PlaybackEngine {
  readonly id: PlaybackEngineId
  /** Media duration in seconds, or 0/NaN when unknown for the loaded source. */
  getDuration(): number
  /** Current playback position in seconds. */
  getTime(): number
  /** Whether audio is currently paused (or not yet started). */
  isPaused(): boolean
  /** Whether the loaded track reached its end. */
  isEnded(): boolean
  /** Whether an audio source is currently loaded into the engine. */
  hasSource(): boolean
  /** The loaded source URL, or null when nothing is loaded. */
  currentSource(): string | null
  /** Swap in the track's audio source and rewind to the start. */
  load(track: MusicTrack): void
  /** Drop the loaded source and silence any ongoing playback. */
  clear(): void
  /** Start (or resume) playback of the loaded source. */
  play(): Promise<void>
  /** Pause playback without forgetting the position. */
  pause(): void
  /** Jump to `seconds` (clamped to ≥ 0) in the loaded source. */
  seekTo(seconds: number): void
  /** Set playback gain, clamped between 0 and 1. */
  setVolume(volume: number): void
  /** Detach all listeners and release the audio resource permanently. */
  dispose(): void
}

/**
 * Spotify track identities (base62) are exactly 22 characters long. Anything
 * shorter, empty or containing a separator is treated as malformed and never
 * converted into a `spotify:track:` URI — an invalid id must not reach the
 * SDK or the Web API.
 */
export function hasValidSpotifyTrackId(track: MusicTrack): boolean {
  if (track.provider !== 'spotify') return false

  const id = track.providerTrackId
  return typeof id === 'string' && /^[0-9A-Za-z]{22}$/.test(id)
}

/**
 * True when the track carries a concrete, non-empty audio URL or a Supabase Storage path.
 * Guarantees that tracks with uploaded Supabase audio route directly to html5-audio,
 * regardless of whether their metadata provider is Spotify, iTunes, or custom.
 */
export function hasDirectAudioUrl(track: MusicTrack): boolean {
  const url = track.playbackUrl || track.audioSourceUrl
  if (typeof url === 'string' && url.trim().length > 0) {
    return true
  }
  if (typeof track.storagePath === 'string' && track.storagePath.trim().length > 0) {
    return true
  }
  return false
}

/**
 * Robust equality check between two tracks, matching by ID, exact providerTrackId,
 * or normalized Spotify track identifier (with or without 'spotify:track:' prefix).
 */
export function isSameTrack(a?: MusicTrack | null, b?: MusicTrack | null): boolean {
  if (!a || !b) return false
  if (a.id && b.id && a.id === b.id) return true
  if (a.providerTrackId && b.providerTrackId) {
    if (a.providerTrackId === b.providerTrackId) return true
    const normA = a.providerTrackId.replace(/^spotify:track:/i, '').trim()
    const normB = b.providerTrackId.replace(/^spotify:track:/i, '').trim()
    if (normA && normB && normA === normB) return true
  }
  return false
}

/**
 * Selects how the current track should be played.
 *
 * Rules:
 * - A Spotify track with a genuine audio URL (the rare Dev Mode preview case)
 *   keeps streaming through the HTML5 engine byte for byte like in P1.
 * - A Spotify metadata-only track with a valid track id plays through the
 *   Spotify Web Playback SDK engine. The SDK leverages the user's own Spotify
 *   client — no audio is downloaded, copied or fabricated.
 * - A Spotify track with a missing/malformed id maps to `'unsupported'`.
 * - Any other provider with a real audio URL uses the HTML5 engine.
 * - Everything else keeps the simulated timer fallback — this is what plays
 *   all demo fixtures, which stream no audio by design. Metadata-only Spotify
 *   tracks never fall through into the timer fallback.
 *
 * The data layer's `isPlayable` flag is untouched by selection.
 */
export function selectTrackPlayback(track: MusicTrack): PlaybackEngineSelection {
  if (hasDirectAudioUrl(track)) {
    return 'html5-audio'
  }

  if (track.provider === 'spotify') {
    return hasValidSpotifyTrackId(track) ? 'spotify-sdk' : 'unsupported'
  }

  return 'timer-fallback'
}
