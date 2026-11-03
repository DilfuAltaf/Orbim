import { ExternalLink, Pencil, Play, Trash2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import { isOwnedByViewer, playlistTracks } from '@/data/mock'
import { useAuth } from '@/features/auth/auth-context'
import { usePlayer } from '@/features/player/player-context'
import type { Playlist } from '@/types/music'

export type PlaylistContextMenuProps = {
  playlist: Playlist | null
  position: { x: number; y: number } | null
  isOpen: boolean
  onClose: () => void
  onEdit?: (playlist: Playlist) => void
  onDelete?: (playlist: Playlist) => void
}

export function PlaylistContextMenu({
  playlist,
  position,
  isOpen,
  onClose,
  onEdit,
  onDelete,
}: PlaylistContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { user } = useAuth()
  const { playQueue } = usePlayer()

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

  if (!isOpen || !position || !playlist) return null

  // Ensure menu stays within screen boundaries
  const menuWidth = 190
  const menuHeight = 160
  const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1000
  const screenHeight = typeof window !== 'undefined' ? window.innerHeight : 800

  const clampedX = Math.max(10, Math.min(position.x, screenWidth - menuWidth - 10))
  const clampedY = Math.max(10, Math.min(position.y, screenHeight - menuHeight - 10))

  const isOwner = user ? playlist.owner.id === user.id : isOwnedByViewer(playlist)
  const tracks = playlistTracks(playlist)

  function handlePlay(e: React.MouseEvent) {
    e.stopPropagation()
    onClose()
    if (playlist && tracks.length > 0) {
      playQueue(tracks, { label: playlist.title })
    }
  }

  function handleOpen(e: React.MouseEvent) {
    e.stopPropagation()
    onClose()
    if (playlist) {
      navigate(`/playlist/${playlist.id}`)
    }
  }

  function handleEditClick(e: React.MouseEvent) {
    e.stopPropagation()
    onClose()
    if (playlist) {
      onEdit?.(playlist)
    }
  }

  function handleDeleteClick(e: React.MouseEvent) {
    e.stopPropagation()
    onClose()
    if (playlist) {
      onDelete?.(playlist)
    }
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
      aria-label={`${playlist.title} options`}
      className="min-w-[190px] rounded-xl border border-border bg-elevated/95 p-1.5 shadow-2xl shadow-background/80 backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-2.5 py-1 text-[10px] font-semibold tracking-wider text-muted uppercase truncate max-w-[170px]">
        {playlist.title}
      </div>

      <div className="my-1 border-t border-border/60" />

      <button
        type="button"
        role="menuitem"
        onClick={handlePlay}
        disabled={tracks.length === 0}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface/80 disabled:opacity-40 disabled:pointer-events-none"
      >
        <Play className="size-3.5 text-accent" strokeWidth={2} />
        <span>Play playlist</span>
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={handleOpen}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface/80"
      >
        <ExternalLink className="size-3.5 text-muted" strokeWidth={1.75} />
        <span>Open playlist</span>
      </button>

      {isOwner ? (
        <>
          <div className="my-1 border-t border-border/60" />

          {onEdit ? (
            <button
              type="button"
              role="menuitem"
              onClick={handleEditClick}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface/80"
            >
              <Pencil className="size-3.5 text-muted" strokeWidth={1.75} />
              <span>Edit details</span>
            </button>
          ) : null}

          {onDelete ? (
            <button
              type="button"
              role="menuitem"
              onClick={handleDeleteClick}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/15 hover:text-red-300"
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} />
              <span>Delete playlist</span>
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
