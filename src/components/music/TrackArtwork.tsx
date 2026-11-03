import { useState } from 'react'

import type { MusicTrack } from '@/types/music'
import { cn } from '@/lib/utils'

/**
 * Generated cover art for demo tracks.
 *
 * Tracks with no artwork URL render deterministic gradients derived from the track id. `artworkUrl` is rendered when a
 * real track provides one, with the generated cover as the fallback.
 */

const palettes = [
  { glow: '#B7F36B', base: '#17251A' },
  { glow: '#A78BFA', base: '#1E1930' },
  { glow: '#5EEAD4', base: '#12262A' },
  { glow: '#FCD34D', base: '#2A2312' },
  { glow: '#F0ABFC', base: '#2A172A' },
  { glow: '#7DD3FC', base: '#12222E' },
] as const

function hashSeed(seed?: string | null): number {
  if (!seed) return 0
  let hash = 0

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100_000
  }

  return hash
}

type TrackArtworkProps = {
  track?: Partial<Pick<MusicTrack, 'providerTrackId' | 'title' | 'artworkUrl'>> | null
  className?: string
}

/** Decorative by design: every caller names the track in adjacent text. Safely renders partial data. */
export function TrackArtwork({ track, className }: TrackArtworkProps) {
  const [hasError, setHasError] = useState(false)
  const trackId = track?.providerTrackId || track?.title || 'track'
  const title = track?.title || 'track'
  const palette = palettes[hashSeed(trackId) % palettes.length]
  const ringOffset = hashSeed(title) % 40

  const showImage = Boolean(track?.artworkUrl && !hasError)

  return (
    <div
      aria-hidden="true"
      className={cn('relative isolate overflow-hidden rounded-lg bg-elevated', className)}
    >
      {showImage && track?.artworkUrl ? (
        <img
          src={track.artworkUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setHasError(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              background: `radial-gradient(135% 135% at 20% 10%, ${palette.glow}38 0%, ${palette.base} 48%, #0a0c0f 100%)`,
            }}
          />
          <div
            aria-hidden="true"
            className="absolute rounded-full border border-white/10"
            style={{
              width: `${74 + ringOffset * 0.2}%`,
              aspectRatio: '1',
              right: '-14%',
              bottom: '-18%',
            }}
          />
          <div
            aria-hidden="true"
            className="absolute rounded-full border border-white/[0.07]"
            style={{
              width: `${46 + ringOffset * 0.15}%`,
              aspectRatio: '1',
              right: '2%',
              bottom: '-4%',
            }}
          />
          <span
            aria-hidden="true"
            className="absolute top-[22%] left-[18%] size-1.5 rounded-full"
            style={{ backgroundColor: palette.glow }}
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-background/35 via-transparent to-transparent"
          />
        </>
      )}
    </div>
  )
}
