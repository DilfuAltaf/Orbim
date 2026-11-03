import { ListMusic } from 'lucide-react'

import { TrackArtwork } from '@/components/music/TrackArtwork'
import { cn } from '@/lib/utils'
import type { Playlist } from '@/types/music'

type PlaylistArtworkProps = {
  playlist: Playlist
  className?: string
  /** Larger covers keep the four-up collage; small ones use the first track only. */
  single?: boolean
}

export function PlaylistArtwork({ playlist, className, single = false }: PlaylistArtworkProps) {
  const tracks = playlist.trackEntries.slice(0, single ? 1 : 4).map((entry) => entry.track)

  if (tracks.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-xl border border-border bg-elevated text-muted',
          className,
        )}
      >
        <ListMusic aria-hidden="true" className="size-5" strokeWidth={1.5} />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'grid overflow-hidden rounded-xl border border-border/70 bg-elevated',
        tracks.length === 1 ? 'grid-cols-1' : 'grid-cols-2 gap-px',
        className,
      )}
    >
      {tracks.map((track) => (
        <TrackArtwork
          key={track.providerTrackId}
          track={track}
          className="size-full rounded-none"
        />
      ))}
    </div>
  )
}
