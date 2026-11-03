import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { Html5AudioEngine } from '@/features/player/html5-audio-engine'
import { PlayerContext } from '@/features/player/player-context'
import type { PlayTrackOptions } from '@/features/player/player-context'
import {
  hasDirectAudioUrl,
  hasValidSpotifyTrackId,
  isSameTrack,
  selectTrackPlayback,
} from '@/features/player/playback-engine'
import { getCachedAudioRecord, resolveEffectiveTrack } from '@/services/audio/global-audio-registry'
import { resolveStoragePublicUrl } from '@/services/audio/audio-storage'
import { SpotifyWebPlaybackEngine } from '@/features/player/spotify-engine'
import type { SpotifyEngineStatus } from '@/features/player/spotify-engine'
import {
  getSpotifySession,
  getValidSpotifyAccessToken,
  isSpotifyConfigured,
  isSpotifyPlaybackAuthorized,
  spotifyMissingPlaybackScopes,
  spotifyScopesIncludePlaybackScopes,
  SPOTIFY_PLAYBACK_REQUIRED_SCOPES,
  SPOTIFY_SESSION_CHANGE_EVENT,
  type SpotifySession,
} from '@/services/spotify'
import { createInitialState, playerReducer } from '@/features/player/player-reducer'
import type { MusicTrack } from '@/types/music'
import {
  buildShuffleQueue,
  buildSmartShuffleQueue,
  cycleRepeatMode,
  cycleShuffleMode,
  isShuffleMode,
  readStoredPlaybackMode,
  restoreOriginalQueue,
  writeStoredPlaybackMode,
  type PlaybackMode,
} from '@/features/player/playback-modes'
import { fetchPublishedCatalogTracks } from '@/services/catalog/global-catalog-service'

type ActiveEngine = Html5AudioEngine | SpotifyWebPlaybackEngine

function buildSpotifyUri(track: MusicTrack): string {
  return `spotify:track:${track.providerTrackId}`
}

/**
 * Robust URL comparator that matches relative vs absolute audio URLs cleanly.
 */
function isSameAudioSource(current: string | null, next: string | null): boolean {
  if (!current || !next) return current === next
  if (current === next) return true
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    const currentPath = new URL(current, origin).pathname
    const nextPath = new URL(next, origin).pathname
    return currentPath === nextPath
  } catch {
    return false
  }
}

/**
 * Resolves a usable access token for the SDK/Web API, or null when the
 * session cannot be refreshed. Tokens are never logged by the engine.
 */
function getSpotifyTokenForPlayback(): Promise<string | null> {
  return getValidSpotifyAccessToken().catch(() => null)
}

/**
 * Queue eligibility. HTML5-audio gates are unchanged (`isPlayable`); Spotify
 * metadata-only tracks additionally require a valid track id plus a session
 * carrying the playback scopes on this very browser.
 * Tracks with registered or cached direct audio are always playable.
 */
function canQueueTrack(track: MusicTrack): boolean {
  if (hasDirectAudioUrl(track)) {
    return true
  }

  if (track.providerTrackId && getCachedAudioRecord(track.providerTrackId)) {
    return true
  }

  if (hasValidSpotifyTrackId(track) && isSpotifyConfigured() && isSpotifyPlaybackAuthorized()) {
    return true
  }

  return track.isPlayable
}

/**
 * Universal Player Provider for ORBIM.
 * Owns ORBIM's queue and shared player context; audio streams through
 * swappable playback engines: the HTML5 engine for real audio URLs (ORBIM,
 * demo, and the rare Spotify preview), the Spotify Web Playback SDK for
 * metadata-only Spotify tracks, and the timer fallback for demo fixtures.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  // The persisted preference (local only) seeds the single playback mode.
  const [state, dispatch] = useReducer(playerReducer, undefined, () =>
    createInitialState(readStoredPlaybackMode()),
  )
  const [isPreparingSmartShuffle, setIsPreparingSmartShuffle] = useState(false)
  const [spotifyEngineStatus, setSpotifyEngineStatus] = useState<SpotifyEngineStatus>({
    kind: 'idle',
    message: null,
  })
  const [spotifySession, setSpotifySession] = useState<SpotifySession | null>(() =>
    getSpotifySession(),
  )

  useEffect(() => {
    const handleSessionChange = () => {
      setSpotifySession(getSpotifySession())
    }

    if (typeof window !== 'undefined') {
      window.addEventListener(SPOTIFY_SESSION_CHANGE_EVENT, handleSessionChange)
      window.addEventListener('storage', handleSessionChange)
      return () => {
        window.removeEventListener(SPOTIFY_SESSION_CHANGE_EVENT, handleSessionChange)
        window.removeEventListener('storage', handleSessionChange)
      }
    }
  }, [])

  const engineRef = useRef<Html5AudioEngine | null>(null)
  const spotifyEngineRef = useRef<SpotifyWebPlaybackEngine | null>(null)
  const currentTrack =
    state.currentIndex >= 0 ? (state.queue[state.currentIndex] ?? null) : null
  const isPlayingRef = useRef(state.isPlaying)
  const currentTrackRef = useRef(currentTrack)
  const volumeRef = useRef(state.volume)
  const modeRef = useRef(state.mode)

  useEffect(() => {
    isPlayingRef.current = state.isPlaying
    currentTrackRef.current = currentTrack
    modeRef.current = state.mode
    writeStoredPlaybackMode(state.mode)
  }, [state.isPlaying, currentTrack, state.mode])

  // Lazily create the Spotify engine. Creation is cheap and does no SDK work:
  // the player connects only inside the first play request (a user gesture).
  const getSpotifyEngine = useCallback(() => {
    if (spotifyEngineRef.current) return spotifyEngineRef.current

    const engine = new SpotifyWebPlaybackEngine({
      playerName: 'ORBIM Web Player',
      getToken: getSpotifyTokenForPlayback,
      events: {
        onTime: (seconds) => {
          dispatch({ type: 'setTime', seconds: Math.floor(seconds) })
        },
        onWaiting: () => {
          dispatch({ type: 'setLoadingAudio', isLoading: true })
        },
        onPlaying: () => {
          dispatch({ type: 'setLoadingAudio', isLoading: false })
          dispatch({ type: 'setPlaying', isPlaying: true })
          dispatch({ type: 'setError', error: null })
        },
        onPause: () => {
          // Preserve state errors marking pauses caused by track end.
          if (!engine.isEnded() && isPlayingRef.current) {
            dispatch({ type: 'setPlaying', isPlaying: false })
          }
        },
        onEnded: () => {
          if (modeRef.current === 'repeat-one') engine.seekTo(0)
          dispatch({ type: 'ended' })
        },
        onError: (detail) => {
          dispatch({
            type: 'setError',
            error: `Spotify playback unavailable (${detail}).`,
          })
        },
      },
      onStatus: setSpotifyEngineStatus,
    })

    engine.setVolume(volumeRef.current)
    spotifyEngineRef.current = engine
    return engine
  }, [])

  const getActiveEngine = useCallback((): ActiveEngine | null => {
    const rawTrack = currentTrackRef.current
    if (!rawTrack) return null
    const track = resolveEffectiveTrack(rawTrack) || rawTrack

    const selection = selectTrackPlayback(track)

    if (selection === 'html5-audio') return engineRef.current
    if (selection === 'spotify-sdk') return getSpotifyEngine()
    return null
  }, [getSpotifyEngine])

  // Initialize the HTML5 playback engine once, mapping audio events onto the
  // reducer.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return

    const engine = new Html5AudioEngine({
      events: {
        onTime: (seconds) => {
          dispatch({ type: 'setTime', seconds: Math.floor(seconds) })
        },
        onWaiting: () => {
          dispatch({ type: 'setLoadingAudio', isLoading: true })
        },
        onPlaying: () => {
          dispatch({ type: 'setLoadingAudio', isLoading: false })
          dispatch({ type: 'setPlaying', isPlaying: true })
          dispatch({ type: 'setError', error: null })
        },
        onPause: () => {
          // Preserve state errors marking pauses caused by track end.
          if (!engine.isEnded() && isPlayingRef.current) {
            dispatch({ type: 'setPlaying', isPlaying: false })
          }
        },
        onEnded: () => {
          if (modeRef.current === 'repeat-one') engine.seekTo(0)
          dispatch({ type: 'ended' })
        },
        onError: (detail) => {
          dispatch({
            type: 'setError',
            error: `Audio preview unavailable for this track (${detail}).`,
          })
        },
      },
    })
    engineRef.current = engine

    return () => {
      // Guarantees audio stops after unmount and listeners never leak.
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  // Dispose the Spotify player on unmount (disconnects the SDK device).
  useEffect(() => {
    return () => {
      spotifyEngineRef.current?.dispose()
      spotifyEngineRef.current = null
    }
  }, [])

  // Synchronize the active engine with the current track.
  useEffect(() => {
    const html5Engine = engineRef.current
    if (!html5Engine) return

    const effectiveTrack: MusicTrack | null = resolveEffectiveTrack(currentTrack)

    const selection = effectiveTrack ? selectTrackPlayback(effectiveTrack) : null

    if (selection === 'html5-audio') {
      // One engine at a time: a shared device cannot legitimately run both.
      spotifyEngineRef.current?.pause()

      const nextUrl = (effectiveTrack?.playbackUrl ||
        effectiveTrack?.audioSourceUrl ||
        (effectiveTrack?.storagePath ? resolveStoragePublicUrl(effectiveTrack.storagePath) : '')) as string
      if (!isSameAudioSource(html5Engine.currentSource(), nextUrl)) {
        html5Engine.load(effectiveTrack as MusicTrack)
        if (state.isPlaying) {
          html5Engine.play().catch((err: unknown) => {
            const isAbort =
              (err instanceof DOMException && err.name === 'AbortError') ||
              (err instanceof Error && err.name === 'AbortError')
            if (isAbort) return
            const message = err instanceof Error ? err.message : 'Playback failed'
            dispatch({
              type: 'setError',
              error: `Unable to play audio preview (${message}).`,
            })
            dispatch({ type: 'setPlaying', isPlaying: false })
          })
        }
      } else if (state.isPlaying && html5Engine.isPaused()) {
        html5Engine.play().catch((err: unknown) => {
          const isAbort =
            (err instanceof DOMException && err.name === 'AbortError') ||
            (err instanceof Error && err.name === 'AbortError')
          if (isAbort) return
          const message = err instanceof Error ? err.message : 'Playback failed'
          dispatch({
            type: 'setError',
            error: `Unable to resume audio preview (${message}).`,
          })
          dispatch({ type: 'setPlaying', isPlaying: false })
        })
      } else if (!state.isPlaying && !html5Engine.isPaused()) {
        html5Engine.pause()
      }
      return
    }

    // Not an HTML5 track: stop HTML5 audio entirely. This also guarantees no
    // fabricated URL can ever leak into the audio element.
    html5Engine.clear()

    if (selection !== 'spotify-sdk' || !currentTrack) {
      // Demo timer tracks and unsupported metadata-only tracks: keep the
      // Spotify device silent as well — a failed Spotify track must never
      // silently turn into simulated playback.
      spotifyEngineRef.current?.pause()
      return
    }

    if (!isSpotifyPlaybackAuthorized()) {
      spotifyEngineRef.current?.pause()
      if (state.isPlaying) {
        dispatch({
          type: 'setError',
          error: `Lagu "${currentTrack.title}" belum memiliki audio. Silakan unggah file audio (.mp3) untuk memutar lagu ini.`,
        })
        dispatch({ type: 'setPlaying', isPlaying: false })
      }
      return
    }

    const spotifyEngine = getSpotifyEngine()
    if (spotifyEngine.currentSource() !== buildSpotifyUri(currentTrack)) {
      try {
        spotifyEngine.load(currentTrack)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Playback failed'
        dispatch({
          type: 'setError',
          error: `Spotify playback unavailable (${message}).`,
        })
        return
      }

      if (state.isPlaying) {
        dispatch({ type: 'setLoadingAudio', isLoading: true })
        spotifyEngine.play().catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Playback failed'
          dispatch({
            type: 'setError',
            error: `Spotify playback failed to start (${message}).`,
          })
        })
      }
    } else if (state.isPlaying && spotifyEngine.isPaused()) {
      spotifyEngine.play().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Playback failed'
        dispatch({
          type: 'setError',
          error: `Spotify playback failed to resume (${message}).`,
        })
      })
    } else if (!state.isPlaying && !spotifyEngine.isPaused()) {
      spotifyEngine.pause()
    }
  }, [currentTrack, state.isPlaying, getSpotifyEngine])

  // Simulated fallback timer for tracks lacking real audio (demo fixtures).
  // Metadata-only Spotify tracks map to 'spotify-sdk' or 'unsupported' and can
  // never reach this simulated progression.
  useEffect(() => {
    if (
      !state.isPlaying ||
      !currentTrack ||
      selectTrackPlayback(currentTrack) !== 'timer-fallback'
    ) {
      return
    }

    const intervalId = window.setInterval(() => dispatch({ type: 'tick' }), 1000)
    return () => window.clearInterval(intervalId)
  }, [state.isPlaying, currentTrack])

  // Keep engine gain synchronized with the volume state.
  useEffect(() => {
    volumeRef.current = state.volume
    engineRef.current?.setVolume(state.volume)
    spotifyEngineRef.current?.setVolume(state.volume)
  }, [state.volume])

  const playQueue = useCallback((tracks: MusicTrack[], options: PlayTrackOptions = {}) => {
    const enrichedTracks = tracks.map((item) => resolveEffectiveTrack(item) || item)

    const playable = enrichedTracks.filter((track) => canQueueTrack(track))
    if (playable.length === 0) return

    const startIndex = Math.min(Math.max(options.startIndex ?? 0, 0), playable.length - 1)

    // A shuffle mode is honoured for the new queue while the untouched source
    // order is kept for restoring it later.
    const ordered = isShuffleMode(modeRef.current)
      ? buildShuffleQueue({ queue: playable, currentTrack: playable[startIndex] })
      : { queue: playable, currentIndex: startIndex }

    dispatch({
      type: 'play',
      queue: ordered.queue,
      originalQueue: playable,
      startIndex: Math.max(ordered.currentIndex, 0),
      label: options.label ?? null,
    })
  }, [])

  const playTrack = useCallback(
    (track: MusicTrack, options: PlayTrackOptions = {}) => {
      const effectiveTrack: MusicTrack = resolveEffectiveTrack(track) || track
      const canQueue = canQueueTrack(effectiveTrack)
      if (!canQueue) {
        return
      }

      const rawQueue = options.queue?.length ? options.queue : [effectiveTrack]
      const enrichedQueue = rawQueue.map((item) => resolveEffectiveTrack(item) || item)

      const playable = enrichedQueue.filter((candidate) => canQueueTrack(candidate))
      let startIndex = playable.findIndex((candidate) => isSameTrack(candidate, effectiveTrack))
      if (startIndex === -1) {
        playable.unshift(effectiveTrack)
        startIndex = 0
      }

      const ordered = isShuffleMode(modeRef.current)
        ? buildShuffleQueue({ queue: playable, currentTrack: playable[startIndex] })
        : { queue: playable, currentIndex: startIndex }

      dispatch({
        type: 'play',
        queue: ordered.queue,
        originalQueue: playable,
        startIndex: Math.max(ordered.currentIndex, 0),
        label: options.label ?? null,
      })
    },
    [],
  )

  const togglePlayback = useCallback(() => {
    const rawTrack = currentTrackRef.current
    if (!rawTrack) {
      return
    }

    const track: MusicTrack = resolveEffectiveTrack(rawTrack) || rawTrack

    const selection = selectTrackPlayback(track)

    if (selection === 'html5-audio') {
      const nextPlaying = !isPlayingRef.current
      if (nextPlaying) {
        dispatch({ type: 'setError', error: null })
      }
      dispatch({ type: 'setPlaying', isPlaying: nextPlaying })
      return
    }

    if (selection === 'spotify-sdk') {
      const engine = getSpotifyEngine()
      if (engine.hasSource()) {
        if (engine.isPaused()) {
          dispatch({ type: 'setPlaying', isPlaying: true })
          engine.play().catch((err: unknown) => {
            dispatch({ type: 'setPlaying', isPlaying: false })
            const message = err instanceof Error ? err.message : 'Playback failed'
            dispatch({
              type: 'setError',
              error: `Spotify playback failed to resume (${message}).`,
            })
          })
        } else {
          dispatch({ type: 'setPlaying', isPlaying: false })
          engine.pause()
        }
        return
      }
    }

    dispatch({ type: 'toggle' })
  }, [getSpotifyEngine])

  const next = useCallback(() => {
    getActiveEngine()?.seekTo(0)
    dispatch({ type: 'next' })
  }, [getActiveEngine])

  const previous = useCallback(() => {
    const engine = getActiveEngine()
    if (engine) {
      const elapsed = Math.floor(engine.getTime())
      if (elapsed > 3) {
        engine.seekTo(0)
        dispatch({ type: 'setTime', seconds: 0 })
        return
      }
      engine.seekTo(0)
    }

    dispatch({ type: 'previous' })
  }, [getActiveEngine])

  const seek = useCallback(
    (seconds: number) => {
      const engine = getActiveEngine()
      const duration = engine?.getDuration() ?? 0
      if (engine && Number.isFinite(duration) && duration > 0) {
        engine.seekTo(Math.min(Math.max(seconds, 0), duration))
      }
      dispatch({ type: 'seek', seconds })
    },
    [getActiveEngine],
  )

  const stop = useCallback(() => {
    const engine = getActiveEngine()
    if (engine) {
      engine.pause()
      engine.seekTo(0)
    }
    dispatch({ type: 'stop' })
  }, [getActiveEngine])

  const clearPlaybackError = useCallback(() => {
    dispatch({ type: 'setError', error: null })
  }, [])

  const setVolume = useCallback((volume: number) => {
    dispatch({ type: 'setVolume', volume })
  }, [])

  /**
   * Applies a playback mode to the live queue.
   *
   * Shuffle reorders a copy of the untouched source order (the playing track
   * stays first, every track appears once). Smart shuffle additionally mixes in
   * published, playable catalog tracks flagged as recommendations. Repeat modes
   * restore the original order so the playlist sequence is never lost.
   */
  const setPlaybackMode = useCallback(
    (mode: PlaybackMode) => {
      const originals = state.originalQueue.length > 0 ? state.originalQueue : state.queue
      const current = state.queue[state.currentIndex] ?? null

      if (originals.length === 0) {
        dispatch({ type: 'setMode', mode })
        return
      }

      if (mode === 'shuffle') {
        const shuffled = buildShuffleQueue({ queue: originals, currentTrack: current })
        dispatch({
          type: 'setMode',
          mode,
          queue: shuffled.queue,
          currentIndex: shuffled.currentIndex,
          originalQueue: originals,
        })
        return
      }

      if (mode === 'smart-shuffle') {
        setIsPreparingSmartShuffle(true)
        fetchPublishedCatalogTracks()
          .then((catalog) => {
            const smart = buildSmartShuffleQueue({
              base: originals,
              recommendations: catalog,
              currentTrack: current,
            })
            dispatch({
              type: 'setMode',
              mode,
              queue: smart.queue,
              currentIndex: smart.currentIndex,
              originalQueue: originals,
            })
          })
          .catch(() => {
            // Catalog unavailable: fall back to a plain shuffle of the playlist
            // rather than leaving playback in a half-applied mode.
            const shuffled = buildShuffleQueue({ queue: originals, currentTrack: current })
            dispatch({
              type: 'setMode',
              mode: 'shuffle',
              queue: shuffled.queue,
              currentIndex: shuffled.currentIndex,
              originalQueue: originals,
            })
          })
          .finally(() => setIsPreparingSmartShuffle(false))
        return
      }

      const restored = restoreOriginalQueue({ originalQueue: originals, currentTrack: current })
      dispatch({
        type: 'setMode',
        mode,
        queue: restored.queue,
        currentIndex: restored.currentIndex,
        originalQueue: originals,
      })
    },
    [state.currentIndex, state.originalQueue, state.queue],
  )

  const cycleRepeat = useCallback(() => {
    setPlaybackMode(cycleRepeatMode(modeRef.current))
  }, [setPlaybackMode])

  const cycleShuffle = useCallback(() => {
    setPlaybackMode(cycleShuffleMode(modeRef.current))
  }, [setPlaybackMode])

  // Spotify playback capability in this browser, reactive to the stored session
  // and real-time session update events.
  const isConnected = spotifySession !== null
  const isPlaybackAuthorized =
    isSpotifyConfigured() &&
    isConnected &&
    spotifyScopesIncludePlaybackScopes(spotifySession.scope)

  const spotifyAvailable = isPlaybackAuthorized
  const spotifyNeedsReconnect =
    isConnected && !spotifyScopesIncludePlaybackScopes(spotifySession.scope)

  // Scopes only (never tokens): which playback permissions Spotify did not
  // grant, so the UI can separate re-consent from account eligibility.
  const spotifyMissingScopes = useMemo(() => {
    return spotifySession
      ? spotifyMissingPlaybackScopes(spotifySession.scope)
      : [...SPOTIFY_PLAYBACK_REQUIRED_SCOPES]
  }, [spotifySession])

  const value = useMemo(
    () => ({
      currentTrack,
      isPlaying: state.isPlaying,
      elapsedSeconds: state.elapsedSeconds,
      volume: state.volume,
      queueLabel: state.queueLabel,
      // Repeat-all wraps at both ends, so the transport mirrors the reducer instead
      // of disabling a move the queue can actually perform.
      canGoNext:
        state.currentIndex >= 0 &&
        (state.currentIndex + 1 < state.queue.length || state.mode === 'repeat-all'),
      canGoPrevious:
        state.currentIndex > 0 ||
        (state.mode === 'repeat-all' && state.queue.length > 1),
      playbackError: state.playbackError,
      isLoadingAudio: state.isLoadingAudio,
      spotifyAvailable,
      spotifyNeedsReconnect,
      spotifyMissingScopes,
      spotifyEngineStatus,
      playbackMode: state.mode,
      isPreparingSmartShuffle,
      cycleRepeatMode: cycleRepeat,
      cycleShuffleMode: cycleShuffle,
      setPlaybackMode,
      playTrack,
      playQueue,
      togglePlayback,
      next,
      previous,
      seek,
      stop,
      clearPlaybackError,
      setVolume,
    }),
    [
      clearPlaybackError,
      spotifyEngineStatus,
      currentTrack,
      isPreparingSmartShuffle,
      cycleRepeat,
      cycleShuffle,
      next,
      playQueue,
      playTrack,
      previous,
      seek,
      setPlaybackMode,
      setVolume,
      spotifyAvailable,
      spotifyNeedsReconnect,
      spotifyMissingScopes,
      state.mode,
      state.currentIndex,
      state.elapsedSeconds,
      state.isLoadingAudio,
      state.isPlaying,
      state.playbackError,
      state.queue.length,
      state.queueLabel,
      state.volume,
      stop,
      togglePlayback,
    ],
  )

  return (
    <PlayerContext.Provider value={value}>
      {children}
    </PlayerContext.Provider>
  )
}
