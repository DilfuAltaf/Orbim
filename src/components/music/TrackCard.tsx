import { ExternalLink, MoreVertical, Pause, Play, Plus, RotateCcw, Upload } from 'lucide-react'
import { useState } from 'react'

import { TrackArtwork } from '@/components/music/TrackArtwork'
import { TrackContextMenu } from '@/components/music/TrackContextMenu'
import { Badge } from '@/components/ui/Badge'
import { IconButton } from '@/components/ui/IconButton'
import { useAuth } from '@/features/auth/auth-context'
import { isSameTrack } from '@/features/player/playback-engine'
import { usePlayer } from '@/features/player/player-context'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { resolveEffectiveTrack } from '@/services/audio/global-audio-registry'
import type { MusicTrack } from '@/types/music'

type TrackCardProps = {
  track: MusicTrack
  queue: MusicTrack[]
  onAdd?: (track: MusicTrack) => void
  onUploadAudio?: (track: MusicTrack) => void
  onReplaceAudio?: (track: MusicTrack) => void
  className?: string
}

export function TrackCard({
  track,
  queue,
  onAdd,
  onUploadAudio,
  onReplaceAudio,
  className,
}: TrackCardProps) {
  const { isAdmin } = useAuth()
  const { currentTrack, isPlaying, playTrack, togglePlayback } = usePlayer()

  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean
    position: { x: number; y: number } | null
  }>({
    isOpen: false,
    position: null,
  })

  const effectiveTrack = resolveEffectiveTrack(track) || track

  const isCurrent = isSameTrack(currentTrack, effectiveTrack)
  const isAudioPlaying = isCurrent && isPlaying
  const canPlay = effectiveTrack.isPlayable

  function handlePlay() {
    if (!canPlay) {
      if (effectiveTrack.provider === 'spotify' && onUploadAudio) {
        onUploadAudio(effectiveTrack)
      }
      return
    }

    if (isCurrent) {
      togglePlayback()
      return
    }

    playTrack(effectiveTrack, { queue, label: 'Explore results' })
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
    })
  }

  function handleOpenMenuFromButton(e: React.MouseEvent) {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    setContextMenu({
      isOpen: true,
      position: { x: rect.left, y: rect.bottom + 6 },
    })
  }

  return (
    <>
      <article
        onContextMenu={handleContextMenu}
        className={cn(
          'group relative flex flex-col rounded-card border bg-surface/60 p-3 transition-colors duration-150 ease-soft hover:bg-surface select-none cursor-pointer',
          isCurrent ? 'border-accent/35' : 'border-border hover:border-border/80',
          className,
        )}
      >
        <div className="relative">
          <TrackArtwork track={effectiveTrack} className="aspect-square w-full" />

          {/* Quick action buttons on top-right (Visible on mobile, hover/focus on desktop) */}
          <div className="absolute top-2 right-2 flex items-center gap-1.5 z-10">
            {onAdd ? (
              <IconButton
                label={`Tambahkan ${effectiveTrack.title} ke playlist`}
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onAdd(effectiveTrack)
                }}
                className={cn(
                  'size-8 rounded-full border border-white/20 bg-background/80 text-foreground backdrop-blur shadow-md transition-all',
                  'hover:bg-accent hover:text-accent-contrast hover:border-accent',
                  'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100',
                )}
              >
                <Plus aria-hidden="true" className="size-4" strokeWidth={2.25} />
              </IconButton>
            ) : null}

            <IconButton
              label={`Opsi untuk ${effectiveTrack.title}`}
              size="sm"
              onClick={handleOpenMenuFromButton}
              className={cn(
                'size-8 rounded-full border border-white/20 bg-background/80 text-foreground backdrop-blur shadow-md transition-all',
                'hover:bg-background/95 hover:text-accent',
                'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100',
              )}
            >
              <MoreVertical aria-hidden="true" className="size-4" strokeWidth={2} />
            </IconButton>
          </div>

          <div className="absolute inset-0 flex items-end justify-between gap-2 p-2.5">
            <button
              type="button"
              onClick={handlePlay}
              disabled={!canPlay && !(effectiveTrack.provider === 'spotify' && Boolean(onUploadAudio))}
              aria-label={
                !canPlay
                  ? effectiveTrack.provider === 'spotify' && onUploadAudio
                    ? `Upload audio to play ${effectiveTrack.title}`
                    : `${effectiveTrack.title} is unavailable`
                  : isAudioPlaying
                    ? `Pause ${effectiveTrack.title}`
                    : `Play ${effectiveTrack.title}`
              }
              className={cn(
                'flex size-10 items-center justify-center rounded-full bg-accent text-accent-contrast shadow-lg shadow-background/40 transition',
                'hover:bg-accent/90 focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none',
                'disabled:pointer-events-none disabled:bg-muted/30 disabled:text-muted',
                isCurrent
                  ? 'opacity-100'
                  : 'opacity-100 sm:translate-y-1 sm:opacity-0 sm:group-hover:translate-y-0 sm:group-hover:opacity-100 sm:group-focus-within:translate-y-0 sm:group-focus-within:opacity-100',
              )}
            >
              {isAudioPlaying ? (
                <Pause aria-hidden="true" className="size-4" strokeWidth={2} />
              ) : !canPlay && effectiveTrack.provider === 'spotify' && onUploadAudio ? (
                <Upload aria-hidden="true" className="size-4" strokeWidth={2} />
              ) : (
                <Play aria-hidden="true" className="size-4" strokeWidth={2} />
              )}
            </button>

            <div className="flex items-center gap-1.5">
              {onUploadAudio && !effectiveTrack.isPlayable ? (
                <IconButton
                  label={`Upload audio for ${effectiveTrack.title}`}
                  variant="outline"
                  size="sm"
                  onClick={() => onUploadAudio(effectiveTrack)}
                  className="size-9 border-white/15 bg-background/60 text-foreground backdrop-blur hover:bg-background/80"
                >
                  <Upload aria-hidden="true" className="size-4" strokeWidth={1.75} />
                </IconButton>
              ) : null}

              {onReplaceAudio && effectiveTrack.isPlayable && isAdmin ? (
                <IconButton
                  label={`Ganti audio untuk ${effectiveTrack.title}`}
                  variant="outline"
                  size="sm"
                  onClick={() => onReplaceAudio(effectiveTrack)}
                  className="size-9 border-white/15 bg-background/60 text-foreground backdrop-blur hover:bg-background/80"
                >
                  <RotateCcw aria-hidden="true" className="size-4" strokeWidth={1.75} />
                </IconButton>
              ) : null}
            </div>
          </div>

          {!effectiveTrack.isPlayable ? (
            <Badge className="absolute top-2 left-2 border-background/40 bg-background/70 backdrop-blur">
              {effectiveTrack.provider === 'spotify' || effectiveTrack.externalUrl ? 'No audio' : 'Unavailable'}
            </Badge>
          ) : (
            <Badge className="absolute top-2 left-2 border-emerald-500/30 text-emerald-400 bg-emerald-500/10 backdrop-blur">
              Audio ready
            </Badge>
          )}
        </div>

        <div className="mt-3 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3
              className={cn(
                'truncate text-sm font-medium',
                isCurrent ? 'text-accent' : 'text-foreground',
              )}
            >
              {track.title}
            </h3>
            {track.isExplicit ? (
              <span
                title="Explicit content"
                className="shrink-0 rounded border border-border bg-elevated px-1 text-[10px] leading-4 font-semibold text-muted"
              >
                E
              </span>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted">{track.artistName}</p>
          {track.albumName ? (
            <p className="truncate text-[11px] text-muted/80">{track.albumName}</p>
          ) : null}
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted">
          {track.externalUrl ? (
            <a
              href={track.externalUrl}
              target="_blank"
              rel="noreferrer"
              title="Open track link"
              className="inline-flex min-w-0 items-center gap-1 rounded font-medium transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none"
            >
              <ExternalLink aria-hidden="true" className="size-3 shrink-0" strokeWidth={1.75} />
              <span className="truncate">
                {track.provider === 'vybe' ? 'VYBE' : 'Link'}
              </span>
            </a>
          ) : (
            <span className="truncate">{track.genre && track.genre !== 'Spotify' ? track.genre : ''}</span>
          )}
          <span className="shrink-0 tabular-nums">
            {track.durationSeconds > 0 ? formatDuration(track.durationSeconds) : '--:--'}
          </span>
        </div>
      </article>

      <TrackContextMenu
        track={effectiveTrack}
        position={contextMenu.position}
        isOpen={contextMenu.isOpen}
        onClose={() => setContextMenu({ isOpen: false, position: null })}
        onAddToPlaylist={onAdd}
        onUploadAudio={onUploadAudio}
        onReplaceAudio={onReplaceAudio}
        queue={queue}
      />
    </>
  )
}
