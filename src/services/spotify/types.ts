/**
 * Type definitions for Spotify Web API and OAuth PKCE integration.
 */

export interface SpotifyTokenResponse {
  access_token: string
  token_type: string
  scope?: string
  expires_in: number
  refresh_token?: string
}

export interface SpotifyUserProfile {
  id: string
  displayName: string
  email?: string
  product?: string
  country?: string
  imageUrl?: string
  profileUrl?: string
}

export interface SpotifySession {
  accessToken: string
  refreshToken?: string
  /** Unix timestamp (in milliseconds) when the access token expires */
  expiresAt: number
  /** Unix timestamp (in milliseconds) when the session / refresh token was issued */
  issuedAt: number
  scope: string
  user?: SpotifyUserProfile
}

export interface SpotifyImage {
  url: string
  height?: number | null
  width?: number | null
}

export interface SpotifyArtist {
  id: string
  name: string
  uri?: string
  external_urls?: {
    spotify?: string
  }
}

export interface SpotifyAlbum {
  id: string
  name: string
  images: SpotifyImage[]
  release_date?: string
  uri?: string
  external_urls?: {
    spotify?: string
  }
}

export interface SpotifyTrackItem {
  id: string
  name: string
  artists: SpotifyArtist[]
  album: SpotifyAlbum
  duration_ms: number
  explicit?: boolean
  preview_url: string | null
  is_playable?: boolean
  external_urls: {
    spotify: string
  }
  uri: string
}

export interface SpotifySearchTracksResponse {
  tracks: {
    href: string
    items: SpotifyTrackItem[]
    limit: number
    next: string | null
    offset: number
    previous: string | null
    total: number
  }
}

export interface SpotifyAuthErrorPayload {
  error: string
  error_description?: string
}
