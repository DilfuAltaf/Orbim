import type { MusicTrack } from '../../types/music.ts'

/**
 * "Recently Added" eligibility & ordering for the Home surface.
 *
 * The section is strictly a view of the global published catalog: a track is
 * eligible only when its catalog record is published, its audio was stored
 * successfully (storage path or direct stream URL), and it is playable.
 * Metadata-only search results, drafts, pending/failed uploads and unpublished
 * records never qualify.
 */

export function recentlyAddedKey(
  track: Pick<MusicTrack, 'provider' | 'providerTrackId' | 'title'>,
): string {
  return `${track.provider}:${track.providerTrackId || track.title}`
}

function hasStoredAudioSource(track: MusicTrack): boolean {
  if (typeof track.storagePath === 'string' && track.storagePath.trim().length > 0) {
    return true
  }

  const url = track.playbackUrl || track.audioSourceUrl
  return typeof url === 'string' && url.trim().length > 0
}

/** Published + playable + backed by a real audio source. */
export function isRecentlyAddedEligible(track: MusicTrack): boolean {
  if (track.publicationStatus && track.publicationStatus !== 'published') return false
  if (!track.isPlayable) return false
  return hasStoredAudioSource(track)
}

/** Milliseconds since publication; unpublished records sort last. */
export function publishedTime(track: MusicTrack): number {
  const raw = track.publishedAt ?? null
  if (!raw) return 0
  const time = new Date(raw).getTime()
  return Number.isNaN(time) ? 0 : time
}

/** Newest publication first, keeping the incoming order for equal timestamps. */
export function sortByPublicationDesc(tracks: MusicTrack[]): MusicTrack[] {
  return tracks
    .map((track, index) => ({ track, index, time: publishedTime(track) }))
    .sort((a, b) => b.time - a.time || a.index - b.index)
    .map((entry) => entry.track)
}

/**
 * Filters, de-duplicates and orders catalog tracks for the section.
 * Duplicate records for the same provider track never appear twice.
 */
export function selectRecentlyAddedTracks(
  tracks: MusicTrack[],
  options: { limit?: number } = {},
): MusicTrack[] {
  const { limit = Number.POSITIVE_INFINITY } = options
  const seen = new Set<string>()
  const eligible: MusicTrack[] = []

  for (const track of tracks) {
    if (!isRecentlyAddedEligible(track)) continue
    const key = recentlyAddedKey(track)
    if (seen.has(key)) continue
    seen.add(key)
    eligible.push(track)
  }

  const sorted = sortByPublicationDesc(eligible)
  return Number.isFinite(limit) ? sorted.slice(0, Math.max(0, limit)) : sorted
}

/**
 * Merges a newly fetched page into the already displayed page, keeping the
 * newest publication first and never duplicating a track.
 */
export function mergeRecentlyAddedTracks(params: {
  existing: MusicTrack[]
  incoming: MusicTrack[]
  limit?: number
}): MusicTrack[] {
  const { existing, incoming, limit } = params
  return selectRecentlyAddedTracks([...existing, ...incoming], { limit })
}
