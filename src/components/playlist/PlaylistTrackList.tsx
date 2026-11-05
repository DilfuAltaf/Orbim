import { ArrowUpDown, ListMusic, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'

import { TrackRow } from '@/components/music/TrackRow'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { buttonVariants } from '@/lib/styles'
import { useAuth } from '@/features/auth/auth-context'
import type { PlaylistSortMode } from '@/components/playlist/PlaylistHeader'
import type { MusicTrack, Playlist, PlaylistTrackEntry } from '@/types/music'

type PlaylistTrackListProps = {
  playlist: Playlist
  trackEntries?: PlaylistTrackEntry[]
  sortMode?: PlaylistSortMode
  onSortChange?: (mode: PlaylistSortMode) => void
  onAdd?: (track: MusicTrack) => void
  onAddTrack?: () => void
  onAttachAudio?: (track: MusicTrack) => void
  onRemoveTrack?: (track: MusicTrack) => void
  canRemoveTrack?: (track: MusicTrack, entry: PlaylistTrackEntry) => boolean
}

const columnTemplate =
  'grid grid-cols-[2rem_2.5rem_minmax(0,1fr)_auto_auto] gap-2.5 px-2.5 sm:grid-cols-[2rem_2.75rem_minmax(0,1fr)_minmax(0,9rem)_auto_auto] sm:gap-3.5'

export function PlaylistTrackList({
  playlist,
  trackEntries,
  sortMode = 'original',
  onSortChange,
  onAdd,
  onAddTrack,
  onAttachAudio,
  onRemoveTrack,
  canRemoveTrack,
}: PlaylistTrackListProps) {
  const { isAdmin } = useAuth()
  const entries = trackEntries ?? playlist.trackEntries
  const tracks = entries.map((e) => e.track)

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={ListMusic}
        title="Playlist ini masih kosong"
        description="Lagu yang ditambahkan ke playlist ini akan muncul di sini beserta siapa yang menambahkan dan kapan."
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            {onAddTrack && isAdmin ? (
              <Button size="sm" onClick={onAddTrack}>
                <Plus aria-hidden="true" className="size-4" strokeWidth={2} />
                Tambah Lagu dengan Audio
              </Button>
            ) : null}
            <Link to="/explore" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Cari lagu di Explore
            </Link>
          </div>
        }
      />
    )
  }

  return (
    <section aria-label={`Tracks in ${playlist.title}`}>
      {/* Track list toolbar with count and sort */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3 mb-2 px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground tracking-tight">
            Daftar Lagu
          </span>
          <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">
            {entries.length} lagu
          </span>
        </div>

        {onSortChange && (
          <div className="flex items-center gap-1.5 text-xs">
            <ArrowUpDown className="size-3.5 text-accent shrink-0" strokeWidth={2} />
            <span className="text-muted text-[11px]">Urutkan:</span>
            <select
              value={sortMode}
              onChange={(e) => onSortChange(e.target.value as PlaylistSortMode)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-foreground focus-visible:outline-none cursor-pointer"
              aria-label="Pilih urutan lagu"
            >
              <option value="original" className="bg-elevated text-foreground">
                Urutan Bawaan
              </option>
              <option value="title" className="bg-elevated text-foreground">
                Judul Lagu (A-Z)
              </option>
              <option value="artist" className="bg-elevated text-foreground">
                Nama Artis (A-Z)
              </option>
              <option value="duration" className="bg-elevated text-foreground">
                Durasi Lagu
              </option>
              <option value="date" className="bg-elevated text-foreground">
                Tanggal Ditambahkan
              </option>
            </select>
          </div>
        )}
      </div>

      <div
        className={`${columnTemplate} border-b border-border pb-2 text-[10px] font-semibold tracking-[0.16em] text-muted uppercase`}
      >
        <button
          type="button"
          onClick={() => onSortChange?.('original')}
          title="Urutkan berdasarkan posisi asli"
          className={`flex items-center justify-center gap-1 hover:text-foreground transition-colors cursor-pointer ${
            sortMode === 'original' ? 'text-accent font-bold' : ''
          }`}
        >
          <span>#</span>
          {sortMode === 'original' ? <span className="text-accent">•</span> : null}
        </button>
        <span />
        <button
          type="button"
          onClick={() => onSortChange?.('title')}
          title="Urutkan berdasarkan judul lagu (A-Z)"
          className={`flex items-center gap-1 text-left hover:text-foreground transition-colors cursor-pointer ${
            sortMode === 'title' ? 'text-accent font-bold' : ''
          }`}
        >
          <span>Judul</span>
          {sortMode === 'title' ? <span className="text-accent">▲</span> : null}
        </button>
        <button
          type="button"
          onClick={() => onSortChange?.('artist')}
          title="Urutkan berdasarkan nama artis/album"
          className={`hidden sm:flex items-center gap-1 text-left hover:text-foreground transition-colors cursor-pointer ${
            sortMode === 'artist' ? 'text-accent font-bold' : ''
          }`}
        >
          <span>Album</span>
          {sortMode === 'artist' ? <span className="text-accent">▲</span> : null}
        </button>
        <button
          type="button"
          onClick={() => onSortChange?.('duration')}
          title="Urutkan berdasarkan durasi"
          className={`flex items-center justify-end gap-1 text-right min-w-[3rem] hover:text-foreground transition-colors cursor-pointer ${
            sortMode === 'duration' ? 'text-accent font-bold' : ''
          }`}
        >
          <span>Durasi</span>
          {sortMode === 'duration' ? <span className="text-accent">▲</span> : null}
        </button>
        <span className="min-w-[2rem]" />
      </div>

      <ul className="mt-1">
        {entries.map((entry, index) => {
          const removable = onRemoveTrack && (!canRemoveTrack || canRemoveTrack(entry.track, entry))
          return (
            <TrackRow
              key={`${entry.track.providerTrackId}-${entry.addedAt}-${index}`}
              track={entry.track}
              position={index + 1}
              queue={tracks}
              queueLabel={playlist.title}
              addedBy={entry.addedBy}
              addedAt={entry.addedAt}
              onAdd={onAdd}
              onAttachAudio={onAttachAudio}
              onRemove={removable ? onRemoveTrack : undefined}
            />
          )
        })}
      </ul>
    </section>
  )
}
