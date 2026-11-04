import {
  ExternalLink,
  ListPlus,
  Mic2,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react'
import { useEffect, useRef } from 'react'

import { TrackArtwork } from '@/components/music/TrackArtwork'
import { useAuth } from '@/features/auth/auth-context'
import { OPEN_LYRICS_EVENT } from '@/features/lyrics/lyrics-panel-state'
import { isSameTrack } from '@/features/player/playback-engine'
import { usePlayer } from '@/features/player/player-context'
import { resolveEffectiveTrack } from '@/services/audio/global-audio-registry'
import type { MusicTrack } from '@/types/music'

export type TrackContextMenuProps = {
  track: MusicTrack | null
  position: { x: number; y: number } | null
  isOpen: boolean
  onClose: () => void
  onAddToPlaylist?: (track: MusicTrack) => void
  onUploadAudio?: (track: MusicTrack) => void
  onReplaceAudio?: (track: MusicTrack) => void
  onRemove?: (track: MusicTrack) => void
  queue?: MusicTrack[]
}

export function TrackContextMenu({
  track,
  position,
  isOpen,
  onClose,
  onAddToPlaylist,
  onUploadAudio,
  onReplaceAudio,
  onRemove,
  queue,
}: TrackContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const { isAdmin } = useAuth()
  const { currentTrack, isPlaying, playTrack, togglePlayback } = usePlayer()

  useEffect(() => {
    if (!isOpen) return

    function handlePointerDown(e: MouseEvent | TouchEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('touchstart', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', onClose, true)

    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('touchstart', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [isOpen, onClose])

  if (!isOpen || !position || !track) return null

  const effectiveTrack = resolveEffectiveTrack(track) || track
  const isCurrent = isSameTrack(currentTrack, effectiveTrack)
  const isAudioPlaying = isCurrent && isPlaying
  const canPlay = effectiveTrack.isPlayable

  // Screen clamping
  const menuWidth = 220
  const menuHeight = 280
  const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1000
  const screenHeight = typeof window !== 'undefined' ? window.innerHeight : 800

  const clampedX = Math.max(10, Math.min(position.x, screenWidth - menuWidth - 10))
  const clampedY = Math.max(10, Math.min(position.y, screenHeight - menuHeight - 10))

  function handlePlay(e: React.MouseEvent) {
    e.stopPropagation()
    onClose()
    if (!canPlay) {
      if (isAdmin && onUploadAudio) {
        onUploadAudio(effectiveTrack)
      }
      return
    }

    if (isCurrent) {
      togglePlayback()
      return
    }

    playTrack(effectiveTrack, {
      queue: queue && queue.length > 0 ? queue : [effectiveTrack],
      label: effectiveTrack.title,
    })
  }

  function handleAddToPlaylist(e: React.MouseEvent) {
    e.stopPropagation()
    onClose()
    onAddToPlaylist?.(effectiveTrack)
  }

  function handleOpenLyrics(e: React.MouseEvent) {
    e.stopPropagation()
    onClose()
    // Open lyrics panel
    window.dispatchEvent(new CustomEvent(OPEN_LYRICS_EVENT))
    // Also start playing if not playing and is playable
    if (canPlay && !isCurrent) {
      playTrack(effectiveTrack, {
        queue: queue && queue.length > 0 ? queue : [effectiveTrack],
        label: effectiveTrack.title,
      })
    }
  }

  function handleOpenLink(e: React.MouseEvent) {
    e.stopPropagation()
    onClose()
    if (effectiveTrack.externalUrl) {
      window.open(effectiveTrack.externalUrl, '_blank', 'noreferrer')
    }
  }

  function handleUploadClick(e: React.MouseEvent) {
    e.stopPropagation()
    onClose()
    onUploadAudio?.(effectiveTrack)
  }

  function handleReplaceClick(e: React.MouseEvent) {
    e.stopPropagation()
    onClose()
    onReplaceAudio?.(effectiveTrack)
  }

  function handleRemoveClick(e: React.MouseEvent) {
    e.stopPropagation()
    onClose()
    onRemove?.(effectiveTrack)
  }

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: `${clampedX}px`,
        top: `${clampedY}px`,
        zIndex: 100,
      }}
      role="menu"
      aria-label={`${effectiveTrack.title} options`}
      className="min-w-[210px] max-w-[260px] rounded-xl border border-border bg-elevated/95 p-1.5 shadow-2xl shadow-background/80 backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 select-none"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Track header */}
      <div className="flex items-center gap-2.5 px-2 py-1.5 border-b border-border/50">
        <TrackArtwork track={effectiveTrack} className="size-8 rounded shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">
            {effectiveTrack.title}
          </p>
          <p className="truncate text-[10px] text-muted">{effectiveTrack.artistName}</p>
        </div>
      </div>

      <div className="py-1 space-y-0.5">
        {/* Tambahkan ke Playlist */}
        {onAddToPlaylist ? (
          <button
            type="button"
            role="menuitem"
            onClick={handleAddToPlaylist}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 transition-colors"
          >
            <ListPlus className="size-4 text-accent shrink-0" strokeWidth={2} />
            <span>Tambahkan ke Playlist</span>
          </button>
        ) : null}

        {/* Putar Lagu / Jeda */}
        <button
          type="button"
          role="menuitem"
          onClick={handlePlay}
          disabled={!canPlay && !(isAdmin && Boolean(onUploadAudio))}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface/80 disabled:opacity-40 disabled:pointer-events-none"
        >
          {isAudioPlaying ? (
            <>
              <Pause className="size-4 text-accent shrink-0" strokeWidth={2} />
              <span>Jeda lagu</span>
            </>
          ) : (
            <>
              <Play className="size-4 text-accent shrink-0" strokeWidth={2} />
              <span>{canPlay ? 'Putar lagu' : 'Belum ada audio'}</span>
            </>
          )}
        </button>

        {/* Lihat Lirik */}
        <button
          type="button"
          role="menuitem"
          onClick={handleOpenLyrics}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface/80"
        >
          <Mic2 className="size-4 text-muted shrink-0" strokeWidth={1.75} />
          <span>Lihat Lirik</span>
        </button>

        {/* Buka Tautan Sumber */}
        {effectiveTrack.externalUrl ? (
          <button
            type="button"
            role="menuitem"
            onClick={handleOpenLink}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface/80"
          >
            <ExternalLink className="size-4 text-muted shrink-0" strokeWidth={1.75} />
            <span>Buka di Spotify</span>
          </button>
        ) : null}

        {/* Admin CRUD actions */}
        {isAdmin && !effectiveTrack.isPlayable && onUploadAudio ? (
          <>
            <div className="my-1 border-t border-border/50" />
            <button
              type="button"
              role="menuitem"
              onClick={handleUploadClick}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 transition-colors"
            >
              <Upload className="size-4 text-accent shrink-0" strokeWidth={2} />
              <span>Upload Audio</span>
            </button>
          </>
        ) : null}

        {isAdmin && effectiveTrack.isPlayable && onReplaceAudio ? (
          <>
            <div className="my-1 border-t border-border/50" />
            <button
              type="button"
              role="menuitem"
              onClick={handleReplaceClick}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted hover:text-foreground hover:bg-surface/80 transition-colors"
            >
              <RotateCcw className="size-4 shrink-0" strokeWidth={1.75} />
              <span>Ganti Audio</span>
            </button>
          </>
        ) : null}

        {/* Remove from playlist */}
        {onRemove ? (
          <>
            <div className="my-1 border-t border-border/50" />
            <button
              type="button"
              role="menuitem"
              onClick={handleRemoveClick}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/15 hover:text-red-300 transition-colors"
            >
              <Trash2 className="size-4 shrink-0" strokeWidth={1.75} />
              <span>Hapus dari Playlist</span>
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
