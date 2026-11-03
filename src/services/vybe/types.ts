/**
 * Type definitions for VYBE Music Library API & SDK integration.
 * Based on official VYBE developer specifications:
 * - https://vybemusic.com/developers/
 * - https://www.vybemusic.com/developers/sdk/
 * - https://www.vybemusic.com/legal/library/
 */

export type VybeCredentialType =
  | 'publishable_key'
  | 'secret_key'
  | 'session_token'
  | 'unknown'

export interface VybeApiArtist {
  name: string
  id?: string
  slug?: string
  url?: string
}

export interface VybeApiAlbum {
  title: string
  id?: string
  slug?: string
}

export interface VybeApiLyricLine {
  time: number
  text: string
}

export interface VybeApiTrackCredits {
  producer?: string[]
  writer?: string[]
  mastering?: string[]
  [key: string]: string[] | undefined
}

/**
 * Raw track item returned by VYBE Library API (v1).
 * Accommodates both string and object shapes for artist/album as documented.
 */
export interface VybeApiTrackItem {
  id: string
  title: string
  artist: string | VybeApiArtist
  album?: string | VybeApiAlbum
  /** Duration in seconds (e.g. 201.4 or integer seconds) */
  duration?: number
  duration_ms?: number
  /** Primary documented artwork image URL */
  artwork?: string
  artwork_url?: string
  /** Signed streaming link (6-hour lifetime) */
  stream_url?: string
  slug?: string
  url?: string
  genre?: string
  vybe?: string
  vibe?: string
  vybes?: string[]
  bpm?: number
  key?: string
  camelot?: string
  energy?: number
  credits?: VybeApiTrackCredits
  lyrics?: VybeApiLyricLine[] | string
  attribution?: string
}

/**
 * Documented usage reporting event types: stream, complete, skip, like.
 */
export type VybeUsageEventType = 'stream' | 'complete' | 'skip' | 'like'

export interface VybeUsageEvent {
  track_id: string
  event: VybeUsageEventType
}

/**
 * Batch payload for POST /v1/usage.
 * Strictly anonymous: never includes listener personal data.
 */
export interface VybeUsagePayload {
  events: VybeUsageEvent[]
}

export interface VybeSearchTracksResponse {
  tracks: VybeApiTrackItem[]
  total?: number
  limit?: number
  offset?: number
}
