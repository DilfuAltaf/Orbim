import { ExternalLink, MoreVertical, Pause, Play, Plus, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'

import { TrackArtwork } from '@/components/music/TrackArtwork'
import { TrackContextMenu } from '@/components/music/TrackContextMenu'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { useAuth } from '@/features/auth/auth-context'
import { isSameTrack } from '@/features/player/playback-engine'
import { usePlayer } from '@/features/player/player-context'
import { formatDuration, formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { resolveEffectiveTrack } from '@/services/audio/global-audio-registry'
import type { MusicTrack, PersonSummary } from '@/types/music'

type TrackRowProps = {
  track: MusicTrack
  position: number
  /** Tracks the play button will queue when this row starts. */
  queue: MusicTrack[]
  queueLabel?: string
  addedBy?: PersonSummary
  addedAt?: string
  onAdd?: (track: MusicTrack) => void
  onAttachAudio?: (track: MusicTrack) => void
  onUploadAudio?: (track: MusicTrack) => void
  onReplaceAudio?: (track: MusicTrack) => void
  onRemove?: (track: MusicTrack) => void
}

export function TrackRow({
  track,
  position,
  queue,
  queueLabel,
  addedBy,
  addedAt,
  onAdd,
  onAttachAudio,
  onUploadAudio,
  onReplaceAudio,
  onRemove,
}: TrackRowProps) {
  const { isAdmin } = useAuth()
  const { currentTrack, isPlaying, playTrack, togglePlayback } = usePlayer()

  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean
    position: { x: number; y: number } | null
  }>({
    isOpen: false,
    position: null,
  })

  const effectiveTrack: MusicTrack = resolveEffectiveTrack(track) || track

  const isCurrent = isSameTrack(currentTrack, effectiveTrack)
  const isAudioPlaying = isCurrent && isPlaying
  const canPlay = effectiveTrack.isPlayable

  const effectiveUploadAction = onUploadAudio || onAttachAudio

  function handlePlay() {
    if (!canPlay) return

    if (isCurrent) {
      togglePlayback()
      return
    }

    playTrack(effectiveTrack, { queue, label: queueLabel })
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
      <li
        onContextMenu={handleContextMenu}
        className={cn(
          'group grid grid-cols-[2rem_2.5rem_minmax(0,1fr)_auto_auto] items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors duration-150 ease-soft sm:grid-cols-[2rem_2.75rem_minmax(0,1fr)_minmax(0,9rem)_auto_auto] sm:gap-3.5 select-none cursor-pointer',
          isCurrent ? 'bg-accent/[0.07]' : 'hover:bg-elevated/50',
        )}
      >
        <div className="relative flex size-8 items-center justify-center">
          <span
            aria-hidden="true"
            className={cn(
              'text-xs tabular-nums text-muted transition-opacity',
              isCurrent ? 'opacity-0' : 'group-hover:opacity-0 group-focus-within:opacity-0',
            )}
          >
            {position}
          </span>
          <IconButton
            label={
              !canPlay
                ? `${effectiveTrack.title} has no audio`
                : isAudioPlaying
                  ? `Pause ${effectiveTrack.title}`
                  : `Play ${effectiveTrack.title}`
            }
            variant="ghost"
            size="sm"
            disabled={!canPlay}
            onClick={handlePlay}
            className={cn(
              'absolute inset-0 m-auto text-foreground',
              isCurrent
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
            )}
          >
            {isAudioPlaying ? (
              <Pause aria-hidden="true" className="size-4" strokeWidth={2} />
            ) : (
              <Play aria-hidden="true" className="size-4" strokeWidth={2} />
            )}
          </IconButton>
        </div>

        <TrackArtwork track={effectiveTrack} className="size-10" />

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p
              className={cn(
                'truncate text-sm font-medium',
                isCurrent ? 'text-accent' : 'text-foreground',
              )}
            >
              {effectiveTrack.title}
            </p>
            {effectiveTrack.verificationStatus === 'verified' ? (
              <Badge className="shrink-0 py-0.5 border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                Verified
              </Badge>
            ) : effectiveTrack.verificationStatus === 'rejected' ? (
              <Badge className="shrink-0 py-0.5 border-rose-500/30 text-rose-400 bg-rose-500/10">
                Rejected
              </Badge>
            ) : effectiveTrack.verificationStatus === 'unverified' ? (
              <Badge className="shrink-0 py-0.5 border-amber-500/30 text-amber-400 bg-amber-500/10">
                Unverified
              </Badge>
            ) : null}
            {effectiveTrack.addedVia === 'ai_cli' ? (
              <span className="shrink-0 rounded bg-accent/15 px-1 py-0.5 text-[10px] font-medium text-accent">
                AI CLI
              </span>
            ) : null}
            {!effectiveTrack.isPlayable ? (
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge className="py-0.5 text-[10px]">
                  {effectiveTrack.provider === 'spotify' ? 'No audio' : 'Unavailable'}
                </Badge>
                {isAdmin && effectiveUploadAction ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => effectiveUploadAction(effectiveTrack)}
                    className="h-5 gap-1 px-1.5 text-[10px] font-medium text-accent hover:text-accent-foreground"
                  >
                    <Upload aria-hidden="true" className="size-3" strokeWidth={2} />
                    Upload Audio
                  </Button>
                ) : null}
              </div>
            ) : (
              <Badge className="shrink-0 py-0.5 border-emerald-500/30 text-emerald-400 bg-emerald-500/10 text-[10px]">
                Audio ready
              </Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted">
            {track.artistName}
            {addedBy ? (
              <span className="text-muted"> · added by {addedBy.displayName}</span>
            ) : null}
          </p>
        </div>

        <div className="hidden min-w-0 sm:block">
          <p className="truncate text-xs text-muted">{track.albumName ?? '—'}</p>
          {addedAt ? (
            <p className="truncate text-[11px] text-muted">{formatRelativeTime(addedAt)}</p>
          ) : null}
        </div>

        <span className="shrink-0 text-right text-xs tabular-nums text-muted min-w-[3rem]">
          {track.durationSeconds > 0 ? formatDuration(track.durationSeconds) : '--:--'}
        </span>

        <div className="flex shrink-0 items-center justify-end gap-1">
          {/* Tambahkan ke Playlist button (Visible on mobile, hover/focus on desktop) */}
          {onAdd ? (
            <IconButton
              label={`Tambahkan ${track.title} ke playlist`}
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onAdd(effectiveTrack)
              }}
              className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 text-muted hover:text-accent transition-opacity"
            >
              <Plus aria-hidden="true" className="size-4" strokeWidth={2} />
            </IconButton>
          ) : null}

          {/* Opsi lainnya button (Visible on mobile, hover/focus on desktop) */}
          <IconButton
            label={`Opsi untuk ${track.title}`}
            size="sm"
            onClick={handleOpenMenuFromButton}
            className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 text-muted hover:text-foreground transition-opacity"
          >
            <MoreVertical aria-hidden="true" className="size-4" strokeWidth={2} />
          </IconButton>

          {track.externalUrl ? (
            <a
              href={track.externalUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Buka tautan ${track.title}`}
              title="Buka tautan lagu"
              className="inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none"
            >
              <ExternalLink aria-hidden="true" className="size-4" strokeWidth={1.75} />
            </a>
          ) : null}
          {effectiveTrack.isPlayable && onReplaceAudio && isAdmin ? (
            <IconButton
              label={`Ganti audio untuk ${track.title}`}
              size="sm"
              onClick={() => onReplaceAudio(effectiveTrack)}
              className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 text-muted hover:text-accent"
            >
              <Upload aria-hidden="true" className="size-4" strokeWidth={1.75} />
            </IconButton>
          ) : null}
          {onRemove ? (
            <IconButton
              label={`Remove ${track.title} from playlist`}
              size="sm"
              onClick={() => onRemove(track)}
              className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 text-muted hover:text-red-400"
            >
              <Trash2 aria-hidden="true" className="size-4" strokeWidth={1.75} />
            </IconButton>
          ) : null}
        </div>
      </li>

      <TrackContextMenu
        track={effectiveTrack}
        position={contextMenu.position}
        isOpen={contextMenu.isOpen}
        onClose={() => setContextMenu({ isOpen: false, position: null })}
        onAddToPlaylist={onAdd}
        onUploadAudio={effectiveUploadAction}
        onReplaceAudio={onReplaceAudio}
        onRemove={onRemove}
        queue={queue}
      />
    </>
  )
}
