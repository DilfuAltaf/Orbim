import type { MusicTrack } from '../../types/music.ts'
import {
  findActiveLyricIndex,
  type ParsedLyrics,
  type SyncedLyricLine,
} from '../../services/lyrics/lyrics-service.ts'

/**
 * Right-hand lyrics panel: open state and presentation state.
 *
 * The open state is a local preference (localStorage) shared between the player
 * transport and the app shell through the existing `orbim:open-lyrics` /
 * `orbim:close-lyrics` window events, so no extra context/provider is added.
 */

export const LYRICS_PANEL_STORAGE_KEY = 'orbim_lyrics_panel_open'
export const OPEN_LYRICS_EVENT = 'orbim:open-lyrics'
export const CLOSE_LYRICS_EVENT = 'orbim:close-lyrics'

export function readLyricsPanelOpen(): boolean {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return false

  try {
    return window.localStorage.getItem(LYRICS_PANEL_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function persistLyricsPanelOpen(isOpen: boolean): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return

  try {
    window.localStorage.setItem(LYRICS_PANEL_STORAGE_KEY, isOpen ? 'true' : 'false')
  } catch {
    // Ignore quota / private-mode restrictions.
  }
}

/** Identity used to keep lyrics bound to the track they were fetched for. */
export function lyricsTrackKey(track: Pick<MusicTrack, 'provider' | 'providerTrackId' | 'title'>): string {
  return `${track.provider}:${track.providerTrackId || track.title}`
}

export type LyricsPanelState =
  | { kind: 'empty'; trackKey: null }
  | { kind: 'loading'; trackKey: string }
  | { kind: 'unavailable'; trackKey: string; message: string }
  | { kind: 'plain'; trackKey: string; lines: string[]; source: string }
  | {
      kind: 'synced'
      trackKey: string
      lines: SyncedLyricLine[]
      activeIndex: number
      source: string
    }

export interface ResolveLyricsPanelStateInput {
  /** Track currently playing in the global player. */
  track: MusicTrack | null
  /** Parsed lyrics that belong to `track`; null while unknown/unavailable. */
  lyrics: ParsedLyrics | null
  isLoading: boolean
  /** Human-readable reason lyrics could not be loaded. */
  error: string | null
  /** Actual audio position (player elapsed seconds). */
  elapsedSeconds: number
}

/**
 * Resolves what the panel shows.
 *
 * Precedence: no track → empty; in-flight fetch → loading; no lyrics → an honest
 * unavailable state (never invented lines); timestamped lyrics → synced lines
 * with the active index derived from the real playback position; otherwise plain
 * lines that are explicitly NOT synchronized.
 */
export function resolveLyricsPanelState(
  input: ResolveLyricsPanelStateInput,
): LyricsPanelState {
  const { track, lyrics, isLoading, error, elapsedSeconds } = input

  if (!track) {
    return { kind: 'empty', trackKey: null }
  }

  const trackKey = lyricsTrackKey(track)

  if (isLoading) {
    return { kind: 'loading', trackKey }
  }

  if (!lyrics) {
    return {
      kind: 'unavailable',
      trackKey,
      message: error || 'Lyrics are not available for this track.',
    }
  }

  if (lyrics.isSynced && lyrics.syncedLines.length > 0) {
    return {
      kind: 'synced',
      trackKey,
      lines: lyrics.syncedLines,
      activeIndex: findActiveLyricIndex(lyrics.syncedLines, elapsedSeconds),
      source: lyrics.source,
    }
  }

  return {
    kind: 'plain',
    trackKey,
    lines: lyrics.plainLines,
    source: lyrics.source,
  }
}
