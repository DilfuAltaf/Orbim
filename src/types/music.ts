/**
 * Application entities for music and playlists.
 *
 * `MusicTrack` mirrors the provider-neutral interface so the ORBIM database
 * provider can normalize entries into this shape without touching the UI.
 * Phase 2 populates it from the local demo catalog only.
 */

export type TrackProvider = 'orbim' | 'custom' | 'demo' | 'spotify' | 'vybe'

export type LyricsStatus = 'not_available' | 'available' | 'partial' | 'licensing_required'
export type MetadataVerificationStatus = 'verified' | 'unverified' | 'rejected'
export type TrackContributionSource = 'web_ui' | 'ai_cli' | 'bulk_import' | 'system'
export type AudioSourceType = 'direct_stream' | 'external_url' | 'storage' | 'none'
export type PublicationStatus = 'draft' | 'published' | 'unpublished'

export interface MusicTrack {
  id?: string
  catalogTrackId?: string
  publicationStatus?: PublicationStatus
  publishedAt?: string | null
  publishedBy?: string | null
  provider: TrackProvider
  providerTrackId: string
  title: string
  artistName: string
  albumName?: string
  artworkUrl?: string
  durationSeconds: number
  releaseDate?: string
  /** Provider-reported explicit-content flag (Spotify). */
  isExplicit?: boolean
  genre: string
  /** Short descriptors used by the Explore filters. */
  moods: string[]
  /**
   * Whether the provider exposes a playable stream. Demo tracks are marked playable
   * to exercise the player UI, but real audio is streamed only when playbackUrl is available.
   */
  isPlayable: boolean
  playbackUrl?: string
  trackUrl?: string
  /** Sumber audio dan tipe sumbernya */
  audioSourceType?: AudioSourceType
  audioSourceUrl?: string
  storagePath?: string
  /** URL eksternal lagu jika tersedia */
  externalUrl?: string
  /** Direct link to the artist profile on the provider platform for attribution */
  artistUrl?: string
  /** Status verifikasi metadata di database ORBIM */
  verificationStatus?: MetadataVerificationStatus
  verifiedBy?: string | null
  verifiedAt?: string | null
  rejectionReason?: string | null
  addedVia?: TrackContributionSource
  addedBy?: string | null
  /** License URL (e.g. Creative Commons license link). */
  licenseUrl?: string
  /** Direct link to the track on the provider's platform for attribution. */
  shareUrl?: string
  /** Audio download URL if permitted by the artist. */
  downloadUrl?: string
  /** Provider attribution text, e.g. "ORBIM Database". */
  attributionText?: string
  /**
   * Set only on Smart Shuffle queue entries that were mixed in from the global
   * catalog. The saved playlist never stores this flag.
   */
  isRecommendation?: boolean
  /** Status ketersediaan lirik dan informasi lisensi resmi */
  lyricsStatus?: LyricsStatus
  lyrics?: string
  /** Cuplikan atau data lirik parsial yang aman ditampilkan tanpa pelanggaran lisensi */
  lyricsSnippet?: string
  lyricsSource?: string
  lyricsNotice?: string
}

export type PlaylistVisibility = 'private' | 'shared'
export type PlaylistRole = 'owner' | 'editor'

export interface PersonSummary {
  id: string
  displayName: string
  location: string
}

export interface Collaborator extends PersonSummary {
  role: PlaylistRole
  joinedAt: string
}

export interface PlaylistTrackEntry {
  track: MusicTrack
  addedBy: PersonSummary
  addedAt: string
}

export interface Playlist {
  id: string
  title: string
  description?: string
  owner: PersonSummary
  visibility: PlaylistVisibility
  collaborators: Collaborator[]
  trackEntries: PlaylistTrackEntry[]
  createdAt: string
  updatedAt: string
}
