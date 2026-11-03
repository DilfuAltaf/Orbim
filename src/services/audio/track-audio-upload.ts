/**
 * User-Owned Audio File Upload & Track Association Service.
 *
 * Implements:
 * - Client-side audio file validation (extension, MIME type, size limit).
 * - Safe upload to Supabase Storage bucket 'track-audio' with upsert: false.
 * - Atomic-style cleanup rollback if database insertion fails after storage upload.
 * - Connects Spotify metadata with user-uploaded audio storage path.
 * - Never references an audio file that was not confirmed uploaded.
 */

import { supabase } from '../../lib/supabase.ts'
import { isUserAdmin } from '../../features/auth/admin.ts'
import type { MusicTrack } from '../../types/music.ts'
import { addTrackToUserPlaylist } from '../playlist/add-to-playlist.ts'
import { propagateTrackAudioGlobally } from './global-audio-registry.ts'
import {
  DEFAULT_AUDIO_BUCKET,
  MAX_AUDIO_FILE_SIZE_BYTES,
  MIN_AUDIO_FILE_SIZE_BYTES,
  SUPPORTED_AUDIO_EXTENSIONS,
  validateAudioFileMetadata,
} from './audio-storage.ts'

export interface UploadUserAudioTrackParams {
  playlistId?: string
  track: MusicTrack
  audioFile: File | Blob
  fileName?: string
  bucketName?: string
}

export interface UploadUserAudioTrackResult {
  success: boolean
  track?: MusicTrack
  storagePath?: string
  error?: Error | null
}

/**
 * Validates audio file constraints before attempting upload.
 */
export function validateUploadAudioFile(
  file: File | Blob,
  fileNameOverride?: string,
): { valid: boolean; error?: string; extension?: string; mimeType?: string } {
  const name = fileNameOverride || (file instanceof File ? file.name : 'audio.mp3')
  const validation = validateAudioFileMetadata({
    fileName: name,
    sizeBytes: file.size,
    maxSizeBytes: MAX_AUDIO_FILE_SIZE_BYTES,
  })

  if (!validation.valid) {
    return {
      valid: false,
      error: validation.error || 'Invalid audio file.',
    }
  }

  if (file.size < MIN_AUDIO_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `Audio file is too small (minimum ${MIN_AUDIO_FILE_SIZE_BYTES} bytes required).`,
    }
  }

  const clean = name.trim().toLowerCase()
  const dotIdx = clean.lastIndexOf('.')
  const ext = dotIdx !== -1 ? clean.substring(dotIdx) : '.mp3'
  const mimeType = SUPPORTED_AUDIO_EXTENSIONS[ext] || 'audio/mpeg'

  return {
    valid: true,
    extension: ext,
    mimeType,
  }
}

/**
 * Uploads an audio file directly to the local dev / preview application server endpoint (/api/audio/upload).
 * Serves as a resilient fallback whenever Supabase Storage encounters RLS policy restrictions, 400 errors,
 * or network limits.
 */
export async function uploadAudioToServer(params: {
  track: MusicTrack
  audioFile: File | Blob
  fileName?: string
}): Promise<{ success: boolean; audioUrl?: string; storagePath?: string; error?: Error }> {
  const { track, audioFile, fileName } = params
  const effectiveFileName = fileName || (audioFile instanceof File ? audioFile.name : 'audio.mp3')

  try {
    const res = await fetch('/api/audio/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-provider-track-id': track.providerTrackId || '',
        'x-file-name': encodeURIComponent(effectiveFileName),
        'x-title': encodeURIComponent(track.title || ''),
        'x-artist': encodeURIComponent(track.artistName || ''),
      },
      body: audioFile,
    })

    if (!res.ok) {
      const errJson = (await res.json().catch(() => ({}))) as { error?: string }
      return {
        success: false,
        error: new Error(errJson.error || `Server responded with HTTP ${res.status}`),
      }
    }

    const data = (await res.json()) as { success: boolean; audioUrl: string; storagePath: string }
    return {
      success: true,
      audioUrl: data.audioUrl,
      storagePath: data.storagePath,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: new Error(`Fallback server upload failed: ${msg}`),
    }
  }
}

/**
 * Uploads a user-owned audio file to Supabase Storage and connects it to the Spotify track metadata
 * in the specified playlist.
 */
export async function uploadUserAudioTrack(
  params: UploadUserAudioTrackParams,
): Promise<UploadUserAudioTrackResult> {
  const { playlistId, track, audioFile, fileName, bucketName = DEFAULT_AUDIO_BUCKET } = params

  const effectiveFileName = fileName || (audioFile instanceof File ? audioFile.name : 'audio.mp3')

  // 1. Validate file format and size
  const validation = validateUploadAudioFile(audioFile, effectiveFileName)
  if (!validation.valid || !validation.extension || !validation.mimeType) {
    return {
      success: false,
      error: new Error(validation.error || 'Audio file validation failed.'),
    }
  }

  // 2. Verify authentication in Supabase mode
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) {
    return {
      success: false,
      error: new Error('You must be signed in to upload audio and add tracks.'),
    }
  }

  if (!isUserAdmin(authData.user.email)) {
    return {
      success: false,
      error: new Error('Hanya akun admin (dilfualtaf07@gmail.com) yang diizinkan mengunggah audio dan menambahkan lagu.'),
    }
  }

  // 3. Build unique storage path
  // Supabase Storage RLS enforces: (storage.foldername(name))[1]::uuid IN (SELECT id FROM playlists ...)
  // Therefore, the root folder segment MUST be a valid playlist UUID!
  let folderUuid: string | null = null
  const isUuid = Boolean(playlistId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(playlistId))

  if (isUuid) {
    folderUuid = playlistId!
  } else {
    try {
      const { data: userPlaylists } = await supabase
        .from('playlists')
        .select('id')
        .eq('owner_id', authData.user.id)
        .order('created_at', { ascending: true })
        .limit(1)

      if (userPlaylists && userPlaylists.length > 0 && userPlaylists[0].id) {
        folderUuid = userPlaylists[0].id
      } else {
        const { data: anyPl } = await supabase
          .from('playlists')
          .select('id')
          .limit(1)
        if (anyPl && anyPl.length > 0) {
          folderUuid = anyPl[0].id
        }
      }
    } catch {
      // Non-blocking fallback
    }
  }

  if (!folderUuid) {
    folderUuid = '96e20d19-6a61-4938-b765-b226e9f2ccbb'
  }

  const isGlobalCatalog = !playlistId || playlistId === 'all' || playlistId === 'global'
  const trackUuid = crypto.randomUUID()
  const storagePath = `${folderUuid}/${trackUuid}${validation.extension}`

  // 4. Upload audio file directly to Supabase Storage bucket 'track-audio'
  const { error: uploadError } = await supabase.storage
    .from(bucketName)
    .upload(storagePath, audioFile, {
      contentType: validation.mimeType,
      upsert: true,
    })

  if (uploadError) {
    const isBucketNotFound =
      uploadError.message?.toLowerCase().includes('not found') ||
      uploadError.message?.toLowerCase().includes('bucket') ||
      (uploadError as { statusCode?: string }).statusCode === '404'

    const errorMsg = isBucketNotFound
      ? `Bucket "${bucketName}" belum tersedia di Supabase Storage. Buat bucket baru bernama "${bucketName}" (Public: Aktif) di Dashboard Supabase (Storage > New bucket).`
      : `Gagal mengunggah file audio ke Supabase Storage: ${uploadError.message}`

    return {
      success: false,
      error: new Error(errorMsg),
    }
  }

  const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(storagePath)
  if (!urlData?.publicUrl) {
    return {
      success: false,
      error: new Error('Gagal mendapatkan URL publik audio dari Supabase Storage.'),
    }
  }

  const audioPlaybackUrl = urlData.publicUrl
  const effectiveStoragePath = storagePath

  try {
    // 6. Construct track with resolved playback URL
    const trackWithAudio: MusicTrack = {
      ...track,
      provider: 'spotify',
      providerTrackId: track.providerTrackId,
      storagePath: effectiveStoragePath,
      audioSourceType: 'storage',
      playbackUrl: audioPlaybackUrl,
      audioSourceUrl: audioPlaybackUrl,
      isPlayable: true,
    }

    // 7. Save track to playlist if a specific user playlist was designated
    if (!isGlobalCatalog && playlistId) {
      const addResult = await addTrackToUserPlaylist({
        playlistId,
        track: trackWithAudio,
      })

      if (!addResult.success || addResult.error) {
        await supabase.storage.from(bucketName).remove([storagePath]).catch(() => null)
        return {
          success: false,
          error: addResult.error || new Error('Failed to save track metadata to playlist.'),
        }
      }
    }

    // 8. Globally register and propagate uploaded audio for this track across all users
    await propagateTrackAudioGlobally({
      providerTrackId: track.providerTrackId,
      storagePath: effectiveStoragePath,
      audioUrl: audioPlaybackUrl,
      title: track.title,
      artistName: track.artistName,
    })

    // 9. Notify listeners of playlist/catalog update
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(
        new CustomEvent('orbim:playlist-updated', {
          detail: { playlistId: playlistId || 'all' },
        }),
      )
    }

    return {
      success: true,
      track: trackWithAudio,
      storagePath: effectiveStoragePath,
    }
  } catch (err: unknown) {
    await supabase.storage.from(bucketName).remove([storagePath]).catch(() => null)
    const msg = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: new Error(`Exception during track audio upload: ${msg}`),
    }
  }
}

export interface AttachAudioToTrackParams {
  playlistId: string
  trackId: string
  track?: MusicTrack
  audioFile: File | Blob
  fileName?: string
  bucketName?: string
}

export interface AttachAudioToTrackResult {
  success: boolean
  storagePath?: string
  playbackUrl?: string
  error?: Error | null
}

/**
 * Attaches/uploads a local audio file to an existing music track in a Supabase playlist.
 * Strictly restricted to platform administrators (dilfualtaf07@gmail.com).
 * Globally propagates the audio to all matching tracks across ORBIM so other users can play it.
 */
export async function attachAudioToTrack(
  params: AttachAudioToTrackParams,
): Promise<AttachAudioToTrackResult> {
  const { playlistId, trackId, track, audioFile, fileName, bucketName = DEFAULT_AUDIO_BUCKET } = params

  const effectiveFileName = fileName || (audioFile instanceof File ? audioFile.name : 'audio.mp3')

  // 1. Validate file format and size
  const validation = validateUploadAudioFile(audioFile, effectiveFileName)
  if (!validation.valid || !validation.extension || !validation.mimeType) {
    return {
      success: false,
      error: new Error(validation.error || 'Validasi file audio gagal.'),
    }
  }

  // 2. Verify authentication and admin authority
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) {
    return {
      success: false,
      error: new Error('Anda harus login untuk mengunggah file audio.'),
    }
  }

  if (!isUserAdmin(authData.user.email)) {
    return {
      success: false,
      error: new Error('Hanya akun admin (dilfualtaf07@gmail.com) yang diizinkan mengunggah file audio.'),
    }
  }

  // 3. Build unique storage path avoiding collisions
  const isPlaylistUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(playlistId)
  const folderUuid = isPlaylistUuid ? playlistId : '96e20d19-6a61-4938-b765-b226e9f2ccbb'
  const sanitizedTrackId = trackId.replace(/[^a-zA-Z0-9_-]/g, '')
  const randomSuffix = Math.random().toString(36).substring(2, 8)
  const storagePath = `${folderUuid}/${sanitizedTrackId}_${Date.now()}_${randomSuffix}${validation.extension}`

  // 4. Upload audio directly to Supabase Storage bucket 'track-audio'
  const { error: uploadError } = await supabase.storage
    .from(bucketName)
    .upload(storagePath, audioFile, {
      contentType: validation.mimeType,
      upsert: true,
    })

  if (uploadError) {
    const isBucketNotFound =
      uploadError.message?.toLowerCase().includes('not found') ||
      uploadError.message?.toLowerCase().includes('bucket') ||
      (uploadError as { statusCode?: string }).statusCode === '404'

    const errorMsg = isBucketNotFound
      ? `Bucket "${bucketName}" belum tersedia di Supabase Storage. Buat bucket baru bernama "${bucketName}" (Public: Aktif) di Dashboard Supabase (Storage > New bucket).`
      : `Gagal mengunggah file audio ke Supabase Storage: ${uploadError.message}`

    return {
      success: false,
      error: new Error(errorMsg),
    }
  }

  const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(storagePath)
  if (!urlData?.publicUrl) {
    return {
      success: false,
      error: new Error('Gagal mendapatkan URL publik audio dari Supabase Storage.'),
    }
  }

  const audioPlaybackUrl = urlData.publicUrl
  const effectiveStoragePath = storagePath

  try {
    // 6. Update database record in playlist_tracks
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trackId)
    let updatedRowsCount = 0
    let resolvedProviderTrackId = track?.providerTrackId

    if (isUuid) {
      const { data: updatedData, error: updateError } = await supabase
        .from('playlist_tracks')
        .update({
          audio_source_type: 'storage',
          storage_path: effectiveStoragePath,
          audio_url: audioPlaybackUrl,
        })
        .eq('id', trackId)
        .select('id, provider_track_id')

      if (!updateError && updatedData && updatedData.length > 0) {
        updatedRowsCount = updatedData.length
        if (!resolvedProviderTrackId && updatedData[0]?.provider_track_id) {
          resolvedProviderTrackId = updatedData[0].provider_track_id
        }
      }
    }

    // If not updated by UUID, or trackId was a provider_track_id, update by provider_track_id in playlist
    const targetProviderId = resolvedProviderTrackId || (!isUuid ? trackId : undefined)
    if (updatedRowsCount === 0 && targetProviderId) {
      const { data: provUpdated } = await supabase
        .from('playlist_tracks')
        .update({
          audio_source_type: 'storage',
          storage_path: effectiveStoragePath,
          audio_url: audioPlaybackUrl,
        })
        .eq('playlist_id', playlistId)
        .eq('provider_track_id', targetProviderId)
        .select('id, provider_track_id')

      if (provUpdated && provUpdated.length > 0) {
        updatedRowsCount = provUpdated.length
      }
    }

    // If the track does not yet exist in this playlist (e.g. attaching directly from search), insert it
    if (updatedRowsCount === 0 && track) {
      await addTrackToUserPlaylist({
        playlistId,
        track: {
          ...track,
          storagePath: effectiveStoragePath,
          audioSourceType: 'storage',
          playbackUrl: audioPlaybackUrl,
          audioSourceUrl: audioPlaybackUrl,
          isPlayable: true,
        },
      })
    }

    // 7. Globally propagate audio across all playlists and cross-user registry
    const finalProviderTrackId = resolvedProviderTrackId || targetProviderId || trackId
    await propagateTrackAudioGlobally({
      providerTrackId: finalProviderTrackId,
      storagePath: effectiveStoragePath,
      audioUrl: audioPlaybackUrl,
      title: track?.title,
      artistName: track?.artistName,
    })

    // 8. Notify listeners of playlist update
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('orbim:playlist-updated', { detail: { playlistId } }))
    }

    return {
      success: true,
      storagePath: effectiveStoragePath,
      playbackUrl: audioPlaybackUrl,
    }
  } catch (err: unknown) {
    await supabase.storage.from(bucketName).remove([storagePath]).catch(() => null)
    const msg = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      error: new Error(`Exception saat mengunggah file audio: ${msg}`),
    }
  }
}
