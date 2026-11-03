import { Check, Copy, Loader2, Mic2, Music2, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { TrackArtwork } from '@/components/music/TrackArtwork'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import {
  MIN_RIGHT_WIDTH,
  MAX_RIGHT_WIDTH,
  useLayout,
} from '@/features/layout/layout-context'
import { usePlayer } from '@/features/player/player-context'
import {
  lyricsTrackKey,
  resolveLyricsPanelState,
} from '@/features/lyrics/lyrics-panel-state'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { fetchTrackLyrics, type ParsedLyrics } from '@/services/lyrics/lyrics-service'

type LyricsPanelProps = {
  onClose: () => void
}

/**
 * Right-hand lyrics panel.
 *
 * Independently scrollable, collapsible, and mounted above the player so the
 * transport controls stay usable. On small screens it becomes a full-width
 * drawer that still leaves the player dock visible. Highlighting is driven by
 * the player's real elapsed seconds, so seeking, pausing and track switches all
 * keep the active line correct. Provider attribution is preserved in the footer.
 */
export function LyricsPanel({ onClose }: LyricsPanelProps) {
  const { currentTrack, elapsedSeconds, isPlaying, seek } = usePlayer()
  const {
    rightWidth,
    isDraggingRight,
    isDesktop,
    startDraggingRight,
    resetRightWidth,
    setRightWidth,
  } = useLayout()

  const [lyricsEntry, setLyricsEntry] = useState<{ trackKey: string; data: ParsedLyrics } | null>(
    null,
  )
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hasCopied, setHasCopied] = useState(false)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const activeLineRef = useRef<HTMLDivElement | null>(null)

  const trackKey = currentTrack ? lyricsTrackKey(currentTrack) : null

  const loadLyrics = useCallback(async (track = currentTrack) => {
    if (!track) {
      setLyricsEntry(null)
      setLoadError(null)
      setIsLoading(false)
      return
    }

    const key = lyricsTrackKey(track)
    setIsLoading(true)
    setLoadError(null)

    try {
      const result = await fetchTrackLyrics(track)
      if (result) {
        setLyricsEntry({ trackKey: key, data: result })
        setLoadError(null)
      } else {
        setLyricsEntry(null)
        setLoadError('Lyrics are not available for this track.')
      }
    } catch {
      setLyricsEntry(null)
      setLoadError('Lyrics could not be loaded right now.')
    } finally {
      setIsLoading(false)
    }
  }, [currentTrack])

  // Lyrics always belong to the track that is playing now.
  useEffect(() => {
    let isCancelled = false

    if (!currentTrack) {
      setLyricsEntry(null)
      setLoadError(null)
      setIsLoading(false)
      return
    }

    const key = lyricsTrackKey(currentTrack)
    setIsLoading(true)
    setLoadError(null)

    fetchTrackLyrics(currentTrack)
      .then((result) => {
        if (isCancelled) return
        if (result) {
          setLyricsEntry({ trackKey: key, data: result })
        } else {
          setLyricsEntry(null)
          setLoadError('Lyrics are not available for this track.')
        }
      })
      .catch(() => {
        if (isCancelled) return
        setLyricsEntry(null)
        setLoadError('Lyrics could not be loaded right now.')
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false)
      })

    return () => {
      isCancelled = true
    }
  }, [currentTrack, trackKey])

  const panelState = resolveLyricsPanelState({
    track: currentTrack,
    lyrics: lyricsEntry && lyricsEntry.trackKey === trackKey ? lyricsEntry.data : null,
    isLoading: currentTrack ? isLoading : false,
    error: loadError,
    elapsedSeconds,
  })

  const activeIndex = panelState.kind === 'synced' ? panelState.activeIndex : -1

  // Center the active line inside the panel's own scroll container, so the page
  // itself never scrolls under the user.
  useEffect(() => {
    const container = containerRef.current
    const activeLine = activeLineRef.current
    if (!container || !activeLine || activeIndex < 0) return

    const target =
      activeLine.offsetTop - container.clientHeight / 2 + activeLine.clientHeight / 2

    container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }, [activeIndex, panelState.kind, trackKey])

  function handleCopy() {
    if (panelState.kind !== 'synced' && panelState.kind !== 'plain') return

    const text =
      panelState.kind === 'synced'
        ? panelState.lines.map((line) => line.text).join('\n')
        : panelState.lines.join('\n')

    navigator.clipboard.writeText(text).then(() => {
      setHasCopied(true)
      window.setTimeout(() => setHasCopied(false), 2000)
    })
  }

  const isSynced = panelState.kind === 'synced'

  return (
    <aside
      aria-label="Lyrics"
      className={cn(
        'fixed top-0 right-0 z-40 flex flex-col border-l border-border bg-surface/95 backdrop-blur',
        // Sits exactly on top of the player dock (tab bar + player border + 4rem
        // track row + the mobile progress strip) so transport controls stay reachable.
        'bottom-[calc(3.5rem+1px+4rem+3px+env(safe-area-inset-bottom))] w-full',
        'lg:bottom-[calc(4.5rem+1px)]',
      )}
      style={{
        width: isDesktop ? `${rightWidth}px` : undefined,
      }}
    >
      {/* Resizable handle on left edge */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Ubah ukuran bar kanan"
        aria-valuenow={rightWidth}
        aria-valuemin={MIN_RIGHT_WIDTH}
        aria-valuemax={MAX_RIGHT_WIDTH}
        tabIndex={0}
        onPointerDown={startDraggingRight}
        onDoubleClick={resetRightWidth}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setRightWidth((w) => Math.min(MAX_RIGHT_WIDTH, w + 12))
          if (e.key === 'ArrowRight') setRightWidth((w) => Math.max(MIN_RIGHT_WIDTH, w - 12))
          if (e.key === 'Home') setRightWidth(MIN_RIGHT_WIDTH)
          if (e.key === 'End') setRightWidth(MAX_RIGHT_WIDTH)
        }}
        title="Tarik untuk mengubah lebar bar kanan (Klik ganda untuk reset)"
        className={cn(
          'absolute -left-1.5 top-0 bottom-0 z-50 w-3 cursor-col-resize select-none transition-all group/handle hidden lg:flex',
          'items-center justify-center hover:w-4',
          isDraggingRight && 'w-4',
        )}
      >
        <div
          className={cn(
            'h-full w-[2px] transition-colors duration-150',
            isDraggingRight ? 'bg-accent w-[3px]' : 'bg-transparent group-hover/handle:bg-accent/70',
          )}
        />
      </div>
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Mic2 aria-hidden="true" className="size-4 text-accent" strokeWidth={1.75} />
          Lyrics
          {isPlaying ? (
            <span aria-hidden="true" className="size-1.5 rounded-full bg-accent motion-safe:animate-pulse" />
          ) : null}
        </h2>

        <div className="flex items-center gap-1">
          {panelState.kind === 'synced' || panelState.kind === 'plain' ? (
            <IconButton label="Copy lyrics" size="sm" onClick={handleCopy}>
              {hasCopied ? (
                <Check aria-hidden="true" className="size-4 text-emerald-400" strokeWidth={2} />
              ) : (
                <Copy aria-hidden="true" className="size-4" strokeWidth={1.75} />
              )}
            </IconButton>
          ) : null}

          {currentTrack ? (
            <IconButton
              label="Reload lyrics"
              size="sm"
              disabled={isLoading}
              onClick={() => void loadLyrics()}
            >
              <RefreshCw
                aria-hidden="true"
                className={cn('size-4', isLoading && 'motion-safe:animate-spin')}
                strokeWidth={1.75}
              />
            </IconButton>
          ) : null}

          <IconButton label="Close lyrics panel" size="sm" onClick={onClose}>
            <X aria-hidden="true" className="size-4" strokeWidth={1.75} />
          </IconButton>
        </div>
      </header>

      {currentTrack ? (
        <div className="border-b border-border/70 bg-background/40 px-4 py-3">
          <div className="flex items-center gap-3">
            <TrackArtwork track={currentTrack} className="size-12 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">
                {currentTrack.title}
              </p>
              <p className="truncate text-xs text-muted">{currentTrack.artistName}</p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <Badge tone="neutral" className="py-0 text-[10px] tabular-nums">
                  {formatDuration(elapsedSeconds)}
                  {currentTrack.durationSeconds > 0
                    ? ` / ${formatDuration(currentTrack.durationSeconds)}`
                    : ''}
                </Badge>
                {panelState.kind === 'synced' || panelState.kind === 'plain' ? (
                  <Badge
                    tone={isSynced ? 'accent' : 'neutral'}
                    className="py-0 text-[10px]"
                  >
                    {isSynced ? 'Synced' : 'Plain text'}
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div
        ref={containerRef}
        aria-live="off"
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        {panelState.kind === 'empty' ? (
          <div className="flex h-56 flex-col items-center justify-center px-4 text-center">
            <span className="flex size-12 items-center justify-center rounded-full border border-border bg-elevated/70 text-muted">
              <Music2 aria-hidden="true" className="size-5" strokeWidth={1.75} />
            </span>
            <p className="mt-3.5 text-sm font-semibold text-foreground">No track playing</p>
            <p className="mt-1.5 max-w-[220px] text-xs leading-relaxed text-muted">
              Play a track and its lyrics appear here, synchronized with the audio position.
            </p>
          </div>
        ) : panelState.kind === 'loading' ? (
          <div className="flex h-56 flex-col items-center justify-center px-4 text-center">
            <Loader2 aria-hidden="true" className="size-6 motion-safe:animate-spin text-accent" />
            <p className="mt-3.5 text-sm font-semibold text-foreground">Loading lyrics…</p>
          </div>
        ) : panelState.kind === 'unavailable' ? (
          <div className="flex h-56 flex-col items-center justify-center px-4 text-center">
            <span className="flex size-12 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-400">
              <Mic2 aria-hidden="true" className="size-5" strokeWidth={1.75} />
            </span>
            <p className="mt-3.5 text-sm font-semibold text-foreground">Lyrics unavailable</p>
            <p className="mt-1.5 max-w-[230px] text-xs leading-relaxed text-muted">
              {panelState.message}
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4 gap-1.5"
              onClick={() => void loadLyrics()}
            >
              <RefreshCw aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
              Try again
            </Button>
          </div>
        ) : panelState.kind === 'synced' ? (
          <div className="space-y-1.5 py-2">
            {panelState.lines.map((line, index) => {
              const isActive = index === activeIndex
              const isPassed = index < activeIndex

              return (
                <div
                  key={`${index}-${line.timeSeconds}`}
                  ref={isActive ? activeLineRef : null}
                  onClick={() => seek(line.timeSeconds)}
                  title={`Jump to ${formatDuration(line.timeSeconds)}`}
                  className={cn(
                    'cursor-pointer rounded-lg px-2.5 py-1.5 transition-colors duration-200',
                    'focus-within:ring-2 focus-within:ring-accent/60',
                    isActive
                      ? 'border-l-2 border-accent bg-accent/10 text-foreground'
                      : isPassed
                        ? 'text-muted/70 hover:text-foreground'
                        : 'text-muted hover:bg-elevated/60 hover:text-foreground',
                  )}
                >
                  <p className={cn('leading-relaxed', isActive ? 'text-sm font-semibold' : 'text-sm')}>
                    {line.text || '♪'}
                  </p>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <p className="text-[11px] text-muted">
              Plain lyrics — no timestamps available, so nothing is highlighted.
            </p>
            {panelState.lines.map((line, index) =>
              line === '' ? (
                <div key={`gap-${index}`} className="h-3" />
              ) : (
                <p key={`line-${index}`} className="text-sm leading-relaxed text-foreground/85">
                  {line}
                </p>
              ),
            )}
          </div>
        )}
      </div>

      {panelState.kind === 'synced' || panelState.kind === 'plain' ? (
        <footer className="border-t border-border/70 bg-background/40 px-4 py-2 text-[10px] text-muted">
          <p className="truncate">Lyrics source: {panelState.source}</p>
        </footer>
      ) : null}
    </aside>
  )
}
