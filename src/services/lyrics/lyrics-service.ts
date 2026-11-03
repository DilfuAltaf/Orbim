import type { MusicTrack } from '@/types/music'

export interface SyncedLyricLine {
  timeSeconds: number
  text: string
}

export interface ParsedLyrics {
  raw: string
  isSynced: boolean
  syncedLines: SyncedLyricLine[]
  plainLines: string[]
  source: string
}

const lyricsCache = new Map<string, ParsedLyrics>()

/**
 * Strips common YouTube/visualizer/video artifacts and extraneous punctuation from song titles.
 */
export function cleanTrackTitle(title: string): string {
  return title
    .replace(/\s*[([](official|lyric|video|audio|visualizer|lyrics|hd|4k|remastered)[^)\]]*[)\]]/gi, '')
    .replace(/\s*\b(ft|feat|featuring)\b\.?.*$/i, '')
    .replace(/[?!]+$/, '')
    .trim()
}

/**
 * Strips collaborator listings from artist strings to get primary artist.
 */
export function cleanTrackArtist(artist: string): string {
  return artist
    .split(/[,&]/)[0]
    .replace(/\s*\b(ft|feat|featuring)\b\.?.*$/i, '')
    .trim()
}

/**
 * Parses raw lyrics into synced timestamps if in LRC format, or plain lines.
 */
export function parseLyrics(rawLyrics: string, source = 'Spotify & Web Lyrics Catalog'): ParsedLyrics {
  const normalized = rawLyrics.replace(/\r\n/g, '\n').trim()
  const rawLines = normalized.split('\n')

  const syncedLines: SyncedLyricLine[] = []
  const plainLines: string[] = []

  let foundTimestamp = false

  for (const line of rawLines) {
    const trimmed = line.trim()
    if (!trimmed) {
      plainLines.push('')
      continue
    }

    // Match standard LRC format [mm:ss.xx] or [mm:ss]
    const match = trimmed.match(/^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)$/)
    if (match) {
      foundTimestamp = true
      const min = parseInt(match[1], 10)
      const sec = parseInt(match[2], 10)
      const fraction = match[3] ? parseFloat(`0.${match[3]}`) : 0
      syncedLines.push({
        timeSeconds: min * 60 + sec + fraction,
        text: match[4].trim(),
      })
      plainLines.push(match[4].trim())
    } else {
      plainLines.push(trimmed)
    }
  }

  return {
    raw: normalized,
    isSynced: foundTimestamp && syncedLines.length > 0,
    syncedLines,
    plainLines,
    source,
  }
}

/**
 * Finds the index of the active lyric line given the current playback elapsed seconds.
 */
export function findActiveLyricIndex(
  syncedLines: SyncedLyricLine[],
  elapsedSeconds: number,
): number {
  if (syncedLines.length === 0) return -1

  for (let i = syncedLines.length - 1; i >= 0; i--) {
    if (elapsedSeconds >= syncedLines[i].timeSeconds) {
      return i
    }
  }

  return 0
}

/**
 * Fetches lyrics for a track, trying local cache, server endpoint, and public fallback.
 */
export async function fetchTrackLyrics(
  track: Partial<MusicTrack> & { title: string; artistName: string },
  options?: { signal?: AbortSignal; fetchFn?: typeof fetch },
): Promise<ParsedLyrics | null> {
  const fetchFn = options?.fetchFn || globalThis.fetch
  const cleanTitle = cleanTrackTitle(track.title)
  const cleanArtist = cleanTrackArtist(track.artistName)

  if (!cleanTitle || !cleanArtist) {
    return null
  }

  const cacheKey = `${cleanArtist.toLowerCase()}__${cleanTitle.toLowerCase()}`

  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey)!
  }

  // 1. If track object already has lyrics attached
  if (track.lyrics && track.lyrics.trim()) {
    const parsed = parseLyrics(track.lyrics, track.lyricsSource || 'Spotify / ORBIM Database')
    lyricsCache.set(cacheKey, parsed)
    return parsed
  }

  // 2. Try server-side Spotify/API proxy
  try {
    const serverUrl = `/api/spotify/lyrics?title=${encodeURIComponent(cleanTitle)}&artist=${encodeURIComponent(cleanArtist)}`
    const res = await fetchFn(serverUrl, { signal: options?.signal })
    if (res.ok) {
      const data = (await res.json()) as { lyrics?: string; source?: string }
      if (data.lyrics && data.lyrics.trim()) {
        const parsed = parseLyrics(data.lyrics, data.source || 'Spotify & Web Lyrics Catalog')
        lyricsCache.set(cacheKey, parsed)
        return parsed
      }
    }
  } catch {
    // Proceed to fallback
  }

  // 3. Fallback to direct public lyrics providers
  try {
    const lrcUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`
    const res = await fetchFn(lrcUrl, { signal: options?.signal })
    if (res.ok) {
      const data = (await res.json()) as { syncedLyrics?: string; plainLyrics?: string }
      if (data.syncedLyrics && data.syncedLyrics.trim()) {
        const parsed = parseLyrics(data.syncedLyrics, 'Spotify Synced Lyrics')
        lyricsCache.set(cacheKey, parsed)
        return parsed
      }
      if (data.plainLyrics && data.plainLyrics.trim()) {
        const parsed = parseLyrics(data.plainLyrics, 'Spotify Lyrics')
        lyricsCache.set(cacheKey, parsed)
        return parsed
      }
    }
  } catch {
    // Proceed to next fallback
  }

  try {
    const fallbackUrl = `https://api.lyrics.ovh/v1/${encodeURIComponent(cleanArtist)}/${encodeURIComponent(cleanTitle)}`
    const res = await fetchFn(fallbackUrl, { signal: options?.signal })
    if (res.ok) {
      const data = (await res.json()) as { lyrics?: string }
      if (data.lyrics && data.lyrics.trim()) {
        const parsed = parseLyrics(data.lyrics, 'Spotify & Lyrics Catalog')
        lyricsCache.set(cacheKey, parsed)
        return parsed
      }
    }
  } catch {
    // Both failed
  }

  return null
}

/**
 * Clears the lyrics cache (useful for testing).
 */
export function _resetLyricsCacheForTesting(): void {
  lyricsCache.clear()
}
