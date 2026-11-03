import type { SupabaseClient } from '../../lib/supabase.ts'
import type { MusicTrack, TrackProvider } from '../../types/music.ts'
import { resolveTrackAudioPlayback } from '../audio/audio-storage.ts'
import type { SupabaseTrackRow } from './supabase-playlist.ts'

/**
 * Maps a persisted playlist_tracks row to the provider-neutral MusicTrack shape.
 *
 * Playability is derived strictly from stored audio fields (Storage object or an approved
 * direct stream). Spotify metadata alone never becomes playable audio.
 */
export function mapPlaylistTrackRow(
  row: SupabaseTrackRow,
  supabaseClient?: SupabaseClient,
): MusicTrack {
  const provider = (row.provider as TrackProvider) || 'orbim'
  const playback = resolveTrackAudioPlayback(row, supabaseClient)

  return {
    id: row.id,
    provider,
    providerTrackId: row.provider_track_id,
    title: row.title,
    artistName: row.artist_name,
    albumName: row.album_name || undefined,
    artworkUrl: row.artwork_url || undefined,
    durationSeconds: row.duration_seconds,
    genre:
      provider === 'spotify'
        ? 'Spotify'
        : provider === 'vybe'
          ? 'VYBE Independent'
          : provider === 'orbim'
            ? 'ORBIM Catalog'
            : 'Custom / Imported',
    moods: [],
    isPlayable: playback.isPlayable,
    playbackUrl: playback.playbackUrl,
    audioSourceType: playback.audioSourceType,
    audioSourceUrl: playback.playbackUrl || row.audio_url || undefined,
    storagePath: row.storage_path || undefined,
    attributionText:
      provider === 'orbim'
        ? 'ORBIM Database'
        : provider === 'spotify'
          ? 'Spotify'
          : provider === 'vybe'
            ? 'Music from VYBE'
            : 'Imported song metadata',
    verificationStatus: row.verification_status || 'unverified',
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    rejectionReason: row.rejection_reason,
    addedVia: row.added_via,
    addedBy: row.added_by,
  }
}
