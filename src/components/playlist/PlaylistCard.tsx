import { MoreVertical, Pause, Play } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { CollaboratorList } from '@/components/playlist/CollaboratorList'
import { DeletePlaylistDialog } from '@/components/playlist/DeletePlaylistDialog'
import { EditPlaylistDialog } from '@/components/playlist/EditPlaylistDialog'
import { PlaylistArtwork } from '@/components/playlist/PlaylistArtwork'
import { PlaylistContextMenu } from '@/components/playlist/PlaylistContextMenu'
import { Badge } from '@/components/ui/Badge'
import { isOwnedByViewer, playlistDurationSeconds, playlistTracks } from '@/data/mock'
import { useAuth } from '@/features/auth/auth-context'
import { usePlayer } from '@/features/player/player-context'
import { formatRelativeTime, formatTotalLength, pluralize } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Playlist } from '@/types/music'

type PlaylistCardProps = {
  playlist: Playlist
  className?: string
  onEdit?: (playlist: Playlist) => void
  onDelete?: (playlist: Playlist) => void
}

export function PlaylistCard({
  playlist,
  className,
  onEdit: propOnEdit,
  onDelete: propOnDelete,
}: PlaylistCardProps) {
  const { user, isAdmin } = useAuth()
  const { currentTrack, isPlaying, playQueue, togglePlayback } = usePlayer()

  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)

  const tracks = playlistTracks(playlist)
  const isOwned = user ? playlist.owner.id === user.id || isAdmin : isOwnedByViewer(playlist)
  const isPlayingFromPlaylist =
    currentTrack !== null && tracks.some((track) => track.providerTrackId === currentTrack.providerTrackId)
  const isActive = isPlayingFromPlaylist && isPlaying

  function handlePlay(e: React.MouseEvent) {
    e.stopPropagation()
    if (isPlayingFromPlaylist) {
      togglePlayback()
      return
    }

    playQueue(tracks, { label: playlist.title })
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setContextMenuPos({ x: e.clientX, y: e.clientY })
    setIsMenuOpen(true)
  }

  function handleOpenOptions(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    setContextMenuPos({ x: rect.right, y: rect.bottom + 4 })
    setIsMenuOpen(true)
  }

  function handleEditAction(targetPlaylist: Playlist) {
    if (propOnEdit) {
      propOnEdit(targetPlaylist)
    } else {
      setIsEditOpen(true)
    }
  }

  function handleDeleteAction(targetPlaylist: Playlist) {
    if (propOnDelete) {
      propOnDelete(targetPlaylist)
    } else {
      setIsDeleteOpen(true)
    }
  }

  return (
    <>
      <article
        onContextMenu={handleContextMenu}
        className={cn(
          'group relative flex flex-col rounded-card border bg-surface/50 p-3 transition-colors duration-150 ease-soft hover:bg-surface',
          isPlayingFromPlaylist ? 'border-accent/30' : 'border-border hover:border-border/80',
          className,
        )}
      >
        <div className="relative">
          <Link
            to={`/playlist/${playlist.id}`}
            aria-label={`Open ${playlist.title}`}
            className="block rounded-xl focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
          >
            <PlaylistArtwork playlist={playlist} className="aspect-[4/3] w-full" />
          </Link>

          <Badge
            tone={playlist.visibility === 'shared' ? 'accent' : 'neutral'}
            className="absolute top-2.5 left-2.5 border-background/30 bg-background/70 backdrop-blur"
          >
            {playlist.visibility === 'shared' ? 'Shared' : 'Private'}
          </Badge>

          <button
            type="button"
            onClick={handleOpenOptions}
            aria-label={`Options for ${playlist.title}`}
            title="Playlist options"
            className={cn(
              'absolute top-2.5 right-2.5 flex size-7 items-center justify-center rounded-full bg-background/70 text-foreground backdrop-blur transition-opacity',
              'hover:bg-background/90 focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none',
              'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100',
            )}
          >
            <MoreVertical aria-hidden="true" className="size-4" strokeWidth={2} />
          </button>

          <button
            type="button"
            onClick={handlePlay}
            disabled={tracks.length === 0}
            aria-label={
              isActive ? `Pause ${playlist.title}` : `Play ${playlist.title} from the start`
            }
            className={cn(
              'absolute right-2.5 bottom-2.5 flex size-10 items-center justify-center rounded-full bg-accent text-accent-contrast shadow-lg shadow-background/50 transition',
              'hover:bg-accent/90 focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none',
              'disabled:pointer-events-none disabled:opacity-40',
              'opacity-100 sm:translate-y-1 sm:opacity-0 sm:group-hover:translate-y-0 sm:group-hover:opacity-100 sm:group-focus-within:translate-y-0 sm:group-focus-within:opacity-100',
              isPlayingFromPlaylist && 'sm:translate-y-0 sm:opacity-100',
            )}
          >
            {isActive ? (
              <Pause aria-hidden="true" className="size-4" strokeWidth={2} />
            ) : (
              <Play aria-hidden="true" className="size-4" strokeWidth={2} />
            )}
          </button>
        </div>

        <div className="mt-3 min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-foreground">
            <Link
              to={`/playlist/${playlist.id}`}
              className="rounded transition-colors hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none"
            >
              {playlist.title}
            </Link>
          </h3>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">
            {playlist.description ?? 'No description yet.'}
          </p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          <span>{pluralize(playlist.trackEntries.length, 'track')}</span>
          <span aria-hidden="true">·</span>
          <span>{formatTotalLength(playlistDurationSeconds(playlist))}</span>
          <span aria-hidden="true">·</span>
          <span>Updated {formatRelativeTime(playlist.updatedAt)}</span>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/70 pt-3">
          <CollaboratorList collaborators={playlist.collaborators} />
          <span className="shrink-0 text-[11px] text-muted">
            {isOwned ? 'Yours' : `by ${playlist.owner.displayName}`}
          </span>
        </div>
      </article>

      <PlaylistContextMenu
        playlist={playlist}
        position={contextMenuPos}
        isOpen={isMenuOpen}
        onClose={() => setIsMenuOpen(false)}
        onEdit={handleEditAction}
        onDelete={handleDeleteAction}
      />

      <EditPlaylistDialog
        playlist={playlist}
        open={isEditOpen}
        onClose={() => setIsEditOpen(false)}
      />

      <DeletePlaylistDialog
        playlist={playlist}
        open={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
      />
    </>
  )
}
