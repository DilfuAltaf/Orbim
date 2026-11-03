import {
  ArrowUpDown,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Share2,
  Shuffle,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { CollaboratorList } from '@/components/playlist/CollaboratorList'
import { PlaylistArtwork } from '@/components/playlist/PlaylistArtwork'
import { Badge } from '@/components/ui/Badge'
import { IconButton } from '@/components/ui/IconButton'
import { isOwnedByViewer, playlistDurationSeconds, playlistTracks } from '@/data/mock'
import { useAuth } from '@/features/auth/auth-context'
import { usePlayer } from '@/features/player/player-context'
import { formatRelativeTime, formatTotalLength, pluralize } from '@/lib/format'
import { buttonVariants } from '@/lib/styles'
import { getDataSource } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { Playlist } from '@/types/music'

export type PlaylistSortMode = 'original' | 'title' | 'artist' | 'duration' | 'date'

type PlaylistHeaderProps = {
  playlist: Playlist
  sortMode?: PlaylistSortMode
  onSortChange?: (mode: PlaylistSortMode) => void
  onShare: () => void
  onAddTrack?: () => void
  onEdit?: () => void
  onDelete?: () => void
}

/** Active-state tint shared by the playback mode toggles. */
const ACTIVE_MODE_CLASS = 'border-accent/40 bg-accent/15 text-accent'

function PlaylistMoreActionsMenu({ onDelete }: { onDelete: () => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('touchstart', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('touchstart', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <div className="relative" ref={menuRef}>
      <IconButton
        label="Aksi lainnya"
        variant="outline"
        size="md"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((previous) => !previous)}
      >
        <MoreVertical aria-hidden="true" className="size-4" strokeWidth={2} />
      </IconButton>

      {isOpen ? (
        <div
          role="menu"
          aria-label="Aksi playlist"
          className="absolute top-full right-0 z-30 mt-1 min-w-44 rounded-xl border border-border bg-elevated/95 p-1.5 shadow-2xl shadow-background/80 backdrop-blur-md"
        >
          <div className="px-2.5 py-1 text-[10px] font-semibold tracking-wider text-muted uppercase">
            Hapus &amp; berbahaya
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setIsOpen(false)
              onDelete()
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/15 hover:text-red-300"
          >
            <Trash2 aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
            <span>Hapus Playlist</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function PlaylistHeader({
  playlist,
  sortMode = 'original',
  onSortChange,
  onShare,
  onAddTrack,
  onEdit,
  onDelete,
}: PlaylistHeaderProps) {
  const { user } = useAuth()
  const {
    currentTrack,
    isPlaying,
    playQueue,
    togglePlayback,
    playbackMode,
    cycleRepeatMode,
    setPlaybackMode,
  } = usePlayer()

  const isDemo = getDataSource() === 'demo'
  const tracks = playlistTracks(playlist)
  const isOwned = user ? playlist.owner.id === user.id : isOwnedByViewer(playlist)
  const isCurrentPlaylist =
    currentTrack !== null &&
    tracks.some((track) => track.providerTrackId === currentTrack.providerTrackId)

  function handlePlay() {
    if (isCurrentPlaylist) {
      togglePlayback()
      return
    }

    playQueue(tracks, { label: playlist.title })
  }

  function handleShuffle() {
    const shuffled = [...tracks]

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1))
      ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
    }

    setPlaybackMode('shuffle')
    playQueue(shuffled, { label: `${playlist.title} · Shuffled` })
  }

  function handleSmartShuffle() {
    setPlaybackMode('smart-shuffle')
    playQueue(tracks, { label: `${playlist.title} · Smart Shuffle` })
  }

  function handleRepeatClick() {
    cycleRepeatMode()
    if (!isCurrentPlaylist && tracks.length > 0) {
      playQueue(tracks, { label: playlist.title })
    }
  }

  const isRepeatActive = playbackMode === 'repeat-all' || playbackMode === 'repeat-one'
  const isSmartShuffleActive = playbackMode === 'smart-shuffle'
  const isShuffleActive = playbackMode === 'shuffle'
  const repeatLabel =
    playbackMode === 'repeat-one'
      ? 'Mode ulang: satu lagu'
      : playbackMode === 'repeat-all'
        ? 'Mode ulang: seluruh playlist'
        : 'Mode ulang: mati'

  return (
    <header className="rounded-card border border-border bg-surface/60 p-4 sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:gap-6">
        <PlaylistArtwork
          playlist={playlist}
          className="aspect-square w-32 shrink-0 sm:w-40 lg:w-44"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={playlist.visibility === 'shared' ? 'accent' : 'neutral'}>
              {playlist.visibility === 'shared' ? 'Playlist Kolaboratif' : 'Playlist Pribadi'}
            </Badge>
            <Badge tone={isDemo ? 'violet' : 'accent'}>
              {isDemo ? 'Demo data' : 'Supabase'}
            </Badge>
            <span className="text-xs text-muted">
              {isOwned ? 'Milik Anda' : `Dibuat oleh ${playlist.owner.displayName}`}
            </span>
          </div>

          <h1 className="mt-3 text-2xl leading-tight font-semibold sm:text-3xl">
            {playlist.title}
          </h1>
          {playlist.description ? (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
              {playlist.description}
            </p>
          ) : null}

          <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
            <span>{pluralize(playlist.trackEntries.length, 'track')}</span>
            <span aria-hidden="true">·</span>
            <span>{formatTotalLength(playlistDurationSeconds(playlist))}</span>
            <span aria-hidden="true">·</span>
            <span>Diperbarui {formatRelativeTime(playlist.updatedAt)}</span>
          </p>

          {/* Row 1 — playback controls */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePlay}
              disabled={tracks.length === 0}
              className={buttonVariants({ className: 'gap-2' })}
            >
              {isCurrentPlaylist && isPlaying ? (
                <Pause aria-hidden="true" className="size-4" strokeWidth={2} />
              ) : (
                <Play aria-hidden="true" className="size-4 fill-current ml-0.5" strokeWidth={2} />
              )}
              {isCurrentPlaylist && isPlaying ? 'Jeda' : 'Putar Semua'}
            </button>

            <button
              type="button"
              onClick={handleShuffle}
              disabled={tracks.length < 2}
              aria-pressed={isShuffleActive}
              className={buttonVariants({
                variant: 'secondary',
                className: cn('gap-1.5', isShuffleActive && ACTIVE_MODE_CLASS),
              })}
              title="Acak (Shuffle) daftar lagu dalam playlist"
            >
              <Shuffle aria-hidden="true" className="size-4" strokeWidth={1.75} />
              <span>Acak</span>
            </button>

            <button
              type="button"
              onClick={handleSmartShuffle}
              disabled={tracks.length === 0}
              aria-pressed={isSmartShuffleActive}
              className={buttonVariants({
                variant: 'secondary',
                className: cn(
                  'gap-1.5',
                  isSmartShuffleActive ? ACTIVE_MODE_CLASS : 'text-accent hover:text-accent',
                ),
              })}
              title="Smart Shuffle: memutar lagu playlist dengan rekomendasi cerdas dari ORBIM"
            >
              <Sparkles aria-hidden="true" className="size-4" strokeWidth={2} />
              <span>Smart Shuffle</span>
            </button>

            <IconButton
              label={`${repeatLabel} (klik untuk ganti)`}
              variant={isRepeatActive ? 'accent' : 'outline'}
              size="md"
              onClick={handleRepeatClick}
              disabled={tracks.length === 0}
              aria-pressed={isRepeatActive}
            >
              {playbackMode === 'repeat-one' ? (
                <Repeat1 aria-hidden="true" className="size-4" strokeWidth={2} />
              ) : (
                <Repeat aria-hidden="true" className="size-4" strokeWidth={1.75} />
              )}
            </IconButton>
          </div>

          {/* Row 2 — playlist management */}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {onSortChange ? (
              <div className="flex h-10 items-center gap-1.5 rounded-lg border border-border bg-elevated px-3 text-xs text-foreground transition-colors hover:border-accent/40">
                <ArrowUpDown
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-accent"
                  strokeWidth={2}
                />
                <span className="font-medium text-muted">Urutkan:</span>
                <select
                  value={sortMode}
                  onChange={(event) => onSortChange(event.target.value as PlaylistSortMode)}
                  className="cursor-pointer bg-transparent text-xs font-semibold text-foreground focus-visible:outline-none"
                  aria-label="Urutkan daftar playlist"
                >
                  <option value="original" className="bg-elevated text-foreground">
                    Bawaan (Urutan Asli)
                  </option>
                  <option value="title" className="bg-elevated text-foreground">
                    Judul Lagu (A-Z)
                  </option>
                  <option value="artist" className="bg-elevated text-foreground">
                    Nama Artis (A-Z)
                  </option>
                  <option value="duration" className="bg-elevated text-foreground">
                    Durasi (Terpendek - Terpanjang)
                  </option>
                  <option value="date" className="bg-elevated text-foreground">
                    Tanggal Ditambahkan (Terbaru)
                  </option>
                </select>
              </div>
            ) : null}

            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={onShare}
                className={buttonVariants({ variant: 'secondary', className: 'gap-1.5' })}
              >
                <Share2 aria-hidden="true" className="size-4" strokeWidth={1.75} />
                Kolaborasi
              </button>

              {onAddTrack ? (
                <button
                  type="button"
                  onClick={onAddTrack}
                  className={buttonVariants({ variant: 'secondary', className: 'gap-1.5' })}
                >
                  <Plus aria-hidden="true" className="size-4" strokeWidth={1.75} />
                  Tambah Lagu
                </button>
              ) : null}

              {isOwned && onEdit ? (
                <button
                  type="button"
                  onClick={onEdit}
                  className={buttonVariants({ variant: 'secondary', className: 'gap-1.5' })}
                >
                  <Pencil aria-hidden="true" className="size-4" strokeWidth={1.75} />
                  Edit
                </button>
              ) : null}

              {isOwned && onDelete ? <PlaylistMoreActionsMenu onDelete={onDelete} /> : null}
            </div>
          </div>

          <Link
            to="/explore"
            className="mt-2 inline-flex items-center gap-1.5 rounded text-xs font-medium text-muted transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none"
          >
            <Plus aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
            Cari Lagu di Explore
          </Link>

          <div className="mt-4 flex items-center gap-2 border-t border-border/70 pt-3">
            <CollaboratorList collaborators={playlist.collaborators} />
            <span className="text-[11px] text-muted">
              {pluralize(playlist.collaborators.length, 'collaborator')}
            </span>
          </div>
        </div>
      </div>
    </header>
  )
}
