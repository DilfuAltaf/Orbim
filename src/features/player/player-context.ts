import { createContext, useContext } from 'react'

import type { MusicTrack } from '@/types/music'
import type { PlaybackMode } from '@/features/player/playback-modes'
import type { SpotifyEngineStatus } from '@/features/player/spotify-engine'

export type PlayTrackOptions = {
  /** Replace the queue (e.g. the playlist the track was clicked in). */
  queue?: MusicTrack[]
  /** Human-readable source shown in the player, e.g. a playlist title. */
  label?: string
  /** Position inside `queue` to start from. */
  startIndex?: number
}

/**
 * Spotify playback capability is exposed as plain booleans, re-evaluated by
 * PlayerProvider on every render from the stored session (client configured +
 * playback scopes). Actual playback attempts re-check the session at click
 * time, so a reconnect always becomes playable even if the gate rendered stale.
 */
export interface PlayerContextValue {
  currentTrack: MusicTrack | null
  isPlaying: boolean
  /** Elapsed seconds of the current track. Driven by real audio or timer fallback. */
  elapsedSeconds: number
  /** Player volume between 0 and 1, applied to the active playback engine. */
  volume: number
  queueLabel: string | null
  canGoNext: boolean
  canGoPrevious: boolean
  /** Any error encountered during real audio decoding or network stream playback. */
  playbackError: string | null
  /** Whether the audio element is currently buffering or loading. */
  isLoadingAudio: boolean
  /** Spotify in-app playback possible in this browser/session (playback scopes present). */
  spotifyAvailable: boolean
  /** This browser has a session but it lacks the playback scopes (re-consent needed). */
  spotifyNeedsReconnect: boolean
  /**
   * Playback scopes missing from the granted token scope set (scopes only,
   * never tokens). Empty when authorized; includes `streaming` when Spotify's
   * granted set lacks the Premium-gated streaming permission, which a
   * re-connect alone cannot fix.
   */
  spotifyMissingScopes: string[]
  /** Live Web Playback SDK lifecycle status for status-driven UI. */
  spotifyEngineStatus: SpotifyEngineStatus
  /**
   * Single authoritative playback mode. Repeat and shuffle are mutually
   * exclusive by design, so no contradictory flag combination can occur.
   */
  playbackMode: PlaybackMode
  /** True while Smart Shuffle recommendations are being resolved. */
  isPreparingSmartShuffle: boolean
  /** Repeat cycle: off → repeat-all → repeat-one → off. */
  cycleRepeatMode: () => void
  /** Shuffle cycle: off → shuffle → smart-shuffle → off. */
  cycleShuffleMode: () => void
  /** Select a specific mode (used by menus and tests). */
  setPlaybackMode: (mode: PlaybackMode) => void
  playTrack: (track: MusicTrack, options?: PlayTrackOptions) => void
  playQueue: (tracks: MusicTrack[], options?: PlayTrackOptions) => void
  togglePlayback: () => void
  next: () => void
  previous: () => void
  seek: (seconds: number) => void
  stop: () => void
  clearPlaybackError: () => void
  setVolume: (volume: number) => void
}

export const PlayerContext = createContext<PlayerContextValue | null>(null)

export function usePlayer(): PlayerContextValue {
  const context = useContext(PlayerContext)

  if (!context) {
    throw new Error('usePlayer must be used inside <PlayerProvider>')
  }

  return context
}
