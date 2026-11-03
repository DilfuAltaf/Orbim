import {
  AlertCircle,
  ExternalLink,
  Loader2,
  Mic2,
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { TrackArtwork } from '@/components/music/TrackArtwork'
import { Badge } from '@/components/ui/Badge'
import { IconButton } from '@/components/ui/IconButton'
import { useLayout } from '@/features/layout/layout-context'
import { usePlayer } from '@/features/player/player-context'
import {
  isShuffleMode,
  playbackModeLabel,
} from '@/features/player/playback-modes'
import {
  CLOSE_LYRICS_EVENT,
  OPEN_LYRICS_EVENT,
  readLyricsPanelOpen,
} from '@/features/lyrics/lyrics-panel-state'
import { formatDuration } from '@/lib/format'
import { buttonVariants } from '@/lib/styles'
import { cn } from '@/lib/utils'

/**
 * Persistent player shell.
 *
 * Renders above the mobile tab bar and docks to the bottom of the content column on
 * desktop. Streams real audio when a valid stream URL is available; falls back to
 * a simulated timer for offline demo tracks.
 */
export function MusicPlayer() {
  const { leftWidth, isDesktop } = useLayout()
  const {
    currentTrack,
    isPlaying,
    elapsedSeconds,
    volume,
    queueLabel,
    canGoNext,
    canGoPrevious,
    playbackError,
    isLoadingAudio,
    playbackMode,
    isPreparingSmartShuffle,
    cycleRepeatMode,
    cycleShuffleMode,
    togglePlayback,
    next,
    previous,
    seek,
    stop,
    clearPlaybackError,
    setVolume,
  } = usePlayer()

  // Mirrors the persisted panel state so the transport toggle and the shell agree.
  const [isLyricsActive, setIsLyricsActive] = useState(() => readLyricsPanelOpen())

  useEffect(() => {
    function handleOpen() {
      setIsLyricsActive(true)
    }
    function handleClose() {
      setIsLyricsActive(false)
    }
    window.addEventListener(OPEN_LYRICS_EVENT, handleOpen)
    window.addEventListener(CLOSE_LYRICS_EVENT, handleClose)
    return () => {
      window.removeEventListener(OPEN_LYRICS_EVENT, handleOpen)
      window.removeEventListener(CLOSE_LYRICS_EVENT, handleClose)
    }
  }, [])

  function toggleLyrics() {
    window.dispatchEvent(
      new CustomEvent(isLyricsActive ? CLOSE_LYRICS_EVENT : OPEN_LYRICS_EVENT),
    )
  }

  const isShuffleActive = isShuffleMode(playbackMode)
  const shuffleLabel =
    playbackMode === 'shuffle'
      ? 'Enable smart shuffle'
      : playbackMode === 'smart-shuffle'
        ? 'Turn off shuffle'
        : 'Enable shuffle'
  const repeatLabel =
    playbackMode === 'repeat-all'
      ? 'Enable repeat one'
      : playbackMode === 'repeat-one'
        ? 'Turn off repeat'
        : 'Enable repeat all'
  const modeLabel = playbackModeLabel(playbackMode)

  // 3.5rem tab bar + 1px tab bar border + the device safe area.
  const shellClassName =
    'fixed inset-x-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-40 border-t border-border bg-surface/95 backdrop-blur lg:bottom-0'

  if (!currentTrack) {
    return (
      <aside
        aria-label="Music player"
        className={shellClassName}
        style={{ left: isDesktop ? `${leftWidth}px` : undefined }}
      >
        <div className="flex h-16 items-center gap-3 px-3 sm:px-5 lg:h-[4.5rem]">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-elevated text-muted">
            <Music2 aria-hidden="true" className="size-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Nothing playing</p>
            <p className="truncate text-xs text-muted">
              Ready to stream — search and play music from the ORBIM database.
            </p>
          </div>
          <Link
            to="/explore"
            className={buttonVariants({
              variant: 'secondary',
              size: 'sm',
              className: 'hidden sm:inline-flex',
            })}
          >
            Browse tracks
          </Link>
        </div>
      </aside>
    )
  }

  const duration = Math.max(currentTrack.durationSeconds, 1)
  const progressPercent = Math.min(100, Math.max(0, (elapsedSeconds / duration) * 100))
  const isOrbim = currentTrack.provider === 'orbim'

  return (
    <aside
      aria-label="Music player"
      className={shellClassName}
      style={{ left: isDesktop ? `${leftWidth}px` : undefined }}
    >
      {/* Playback error alert strip */}
      {playbackError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 border-b border-rose-500/30 bg-rose-950/70 px-3 py-1.5 text-xs text-rose-200 sm:px-5"
        >
          <div className="flex items-center gap-2 truncate">
            <AlertCircle aria-hidden="true" className="size-3.5 shrink-0 text-rose-400" />
            <span className="truncate">{playbackError}</span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={clearPlaybackError}
              className="text-[11px] font-medium underline hover:text-white"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {/* Mobile progress indicator keeps playback position visible without a slider. */}
      <div aria-hidden="true" className="h-0.5 w-full bg-border/70 lg:hidden">
        <div
          className="h-full bg-accent transition-[width] duration-300 ease-linear"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="flex h-16 items-center gap-2 px-3 sm:gap-4 sm:px-5 lg:h-[4.5rem]">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Link
            to="/explore"
            aria-label={`Now playing: ${currentTrack.title} by ${currentTrack.artistName}. Open Explore.`}
            className="shrink-0 rounded-lg focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
          >
            <TrackArtwork track={currentTrack} className="size-10 sm:size-12" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium text-foreground">{currentTrack.title}</p>
              {currentTrack.isRecommendation ? (
                <Badge tone="accent" className="shrink-0 py-0.5">
                  Recommended
                </Badge>
              ) : null}
              {currentTrack.provider !== 'spotify' ? (
                <Badge
                  tone={isOrbim ? 'neutral' : 'accent'}
                  className="hidden shrink-0 py-0.5 sm:inline-flex"
                >
                  {currentTrack.provider === 'vybe'
                    ? 'VYBE'
                    : isOrbim
                      ? 'ORBIM'
                      : currentTrack.provider === 'custom'
                        ? 'Custom'
                        : 'Demo'}
                </Badge>
              ) : null}
            </div>
            <p className="truncate text-xs text-muted">
              <span>{currentTrack.artistName}</span>
              {queueLabel ? (
                <span className="hidden text-muted sm:inline"> · from {queueLabel}</span>
              ) : null}
              {modeLabel ? (
                <span className="hidden text-muted sm:inline"> · {modeLabel}</span>
              ) : null}
              {currentTrack.licenseUrl ? (
                <a
                  href={currentTrack.licenseUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Creative Commons license"
                  className="ml-1.5 hidden text-[11px] text-accent/80 hover:underline sm:inline"
                >
                  CC
                </a>
              ) : null}
              {currentTrack.shareUrl ? (
                <a
                  href={currentTrack.shareUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="View track link"
                  title="View track"
                  className="ml-1.5 hidden text-muted hover:text-foreground sm:inline-flex"
                >
                  <ExternalLink aria-hidden="true" className="size-3 self-center" />
                </a>
              ) : null}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-0.5 sm:gap-1.5 lg:flex-1 lg:justify-center">
          <IconButton
            label={shuffleLabel}
            onClick={cycleShuffleMode}
            disabled={isPreparingSmartShuffle}
            className={cn(
              'transition-colors',
              isShuffleActive ? 'text-accent' : 'text-muted hover:text-foreground',
            )}
          >
            {isPreparingSmartShuffle ? (
              <Loader2
                aria-hidden="true"
                className="size-4 motion-safe:animate-spin"
                strokeWidth={2}
              />
            ) : playbackMode === 'smart-shuffle' ? (
              <Sparkles aria-hidden="true" className="size-4" strokeWidth={2} />
            ) : (
              <Shuffle aria-hidden="true" className="size-4" strokeWidth={1.75} />
            )}
          </IconButton>

          <IconButton
            label="Previous track"
            onClick={previous}
            disabled={!canGoPrevious}
            className="hidden sm:inline-flex"
          >
            <SkipBack aria-hidden="true" className="size-4" strokeWidth={1.75} />
          </IconButton>

          <button
            type="button"
            onClick={togglePlayback}
            aria-label={isPlaying ? `Pause ${currentTrack.title}` : `Play ${currentTrack.title}`}
            className="flex size-10 items-center justify-center rounded-full bg-accent text-accent-contrast transition-colors hover:bg-accent/90 focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
          >
            {isLoadingAudio ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" strokeWidth={2} />
            ) : isPlaying ? (
              <Pause aria-hidden="true" className="size-4" strokeWidth={2} />
            ) : (
              <Play aria-hidden="true" className="size-4" strokeWidth={2} />
            )}
          </button>

          <IconButton label="Next track" onClick={next} disabled={!canGoNext}>
            <SkipForward aria-hidden="true" className="size-4" strokeWidth={1.75} />
          </IconButton>

          <IconButton
            label={repeatLabel}
            onClick={cycleRepeatMode}
            className={cn(
              'transition-colors',
              playbackMode === 'repeat-all' || playbackMode === 'repeat-one'
                ? 'text-accent'
                : 'text-muted hover:text-foreground',
            )}
          >
            {playbackMode === 'repeat-one' ? (
              <Repeat1 aria-hidden="true" className="size-4" strokeWidth={2} />
            ) : (
              <Repeat aria-hidden="true" className="size-4" strokeWidth={1.75} />
            )}
          </IconButton>
        </div>

        <div className="hidden flex-1 items-center justify-end gap-3 lg:flex">
          <span className="text-[11px] tabular-nums text-muted">
            {formatDuration(elapsedSeconds)}
          </span>

          <div className="group relative h-4 w-full max-w-56">
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-border"
            >
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <input
              type="range"
              min={0}
              max={duration}
              step={1}
              value={Math.min(elapsedSeconds, duration)}
              onChange={(event) => seek(Number(event.target.value))}
              aria-label={`Seek within ${currentTrack.title}`}
              aria-valuetext={`${formatDuration(elapsedSeconds)} of ${formatDuration(duration)}`}
              className="player-range absolute inset-0 h-full w-full"
            />
          </div>

          <span className="text-[11px] tabular-nums text-muted">
            {currentTrack.durationSeconds > 0 ? formatDuration(currentTrack.durationSeconds) : '--:--'}
          </span>

          <Volume2 aria-hidden="true" className="size-4 shrink-0 text-muted" strokeWidth={1.75} />

          <div className="group relative h-4 w-full max-w-24">
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-border"
            >
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.round(volume * 100)}%` }}
              />
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
              aria-label="Player volume"
              aria-valuetext={`${Math.round(volume * 100)} percent volume`}
              className="player-range absolute inset-0 h-full w-full"
            />
          </div>

          <IconButton
            label={isLyricsActive ? 'Hide lyrics in sidebar' : 'Show lyrics in sidebar'}
            onClick={toggleLyrics}
            title={isLyricsActive ? 'Hide lyrics in sidebar' : 'Open lyrics in sidebar'}
            className={cn(
              'transition-all duration-150',
              isLyricsActive ? 'text-accent bg-accent/15' : 'text-muted hover:text-accent',
            )}
          >
            <Mic2 aria-hidden="true" className="size-4" strokeWidth={isLyricsActive ? 2.25 : 1.75} />
          </IconButton>

          <IconButton label="Close player" onClick={stop}>
            <X aria-hidden="true" className="size-4" strokeWidth={1.75} />
          </IconButton>
        </div>

        <div className="lg:hidden flex items-center gap-1">
          <IconButton
            label={isLyricsActive ? 'Hide lyrics' : 'Show lyrics'}
            onClick={toggleLyrics}
            title={isLyricsActive ? 'Hide lyrics' : 'Open lyrics'}
            className={cn(
              'transition-all duration-150',
              isLyricsActive ? 'text-accent bg-accent/15' : 'text-muted hover:text-accent',
            )}
          >
            <Mic2 aria-hidden="true" className="size-4" strokeWidth={isLyricsActive ? 2.25 : 1.75} />
          </IconButton>
          <IconButton label="Close player" onClick={stop}>
            <X aria-hidden="true" className="size-4" strokeWidth={1.75} />
          </IconButton>
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {isPlaying
          ? `Playing ${currentTrack.title} by ${currentTrack.artistName} from ${
              isOrbim ? 'the ORBIM database' : 'the demo catalog'
            }.`
          : `Paused on ${currentTrack.title} by ${currentTrack.artistName}.`}
      </p>
    </aside>
  )
}
