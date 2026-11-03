import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../types/database.ts'
import type { AudioSourceType } from '../../types/music.ts'
import {
  DEFAULT_AUDIO_BUCKET,
  uploadTrackAudioToSupabase,
  validateAudioFileMetadata,
  validateAudioSourceUrl,
} from '../audio/audio-storage.ts'

export const MAX_OPERATOR_BATCH_SIZE = 11

export interface OperatorTrackInput {
  title: string
  artist: string
  album?: string
  artworkUrl?: string
  durationSeconds?: number
  lyricsStatus?: 'not_available' | 'available' | 'partial' | 'licensing_required'
  lyricsSource?: string
  lyricsSnippet?: string
  lyrics?: string
  audioFile?: string
  audioBuffer?: Uint8Array
  audioFileName?: string
  audioSourceType?: AudioSourceType
  audioSourceUrl?: string
  storagePath?: string
  externalUrl?: string
  license?: string
}

export interface ValidatedOperatorTrack {
  valid: boolean
  title: string
  artistName: string
  albumName?: string
  artworkUrl?: string
  durationSeconds: number
  lyricsStatus: 'not_available' | 'available' | 'partial' | 'licensing_required'
  lyricsSource?: string
  lyricsSnippet?: string
  lyrics?: string
  audioSourceType: AudioSourceType
  audioSourceUrl?: string
  audioFile?: string
  audioBuffer?: Uint8Array
  audioFileName?: string
  storagePath?: string
  externalUrl?: string
  isPlayable: boolean
  hasAudioUpload: boolean
  validationErrors: string[]
  isPartialData: boolean
  partialNotes: string[]
}

export interface OperatorBatchReport {
  timestamp: string
  playlistId: string
  batchLimit: number
  totalReceived: number
  totalProcessed: number
  wasTruncated: boolean
  succeeded: Array<{
    id?: string
    title: string
    artistName: string
    position: number
    verified: boolean
    verificationStatus?: 'unverified' | 'verified' | 'rejected'
    addedVia?: 'web_ui' | 'ai_cli' | 'bulk_import' | 'system'
    hasAudio?: boolean
    isPlayable?: boolean
    audioSourceType?: AudioSourceType
    audioUrl?: string | null
    storagePath?: string | null
  }>
  duplicates: Array<{
    title: string
    artistName: string
    reason: 'duplicate_in_batch' | 'duplicate_in_target_playlist'
  }>
  failed: Array<{
    title: string
    artistName: string
    errors: string[]
  }>
  needsCorrection: Array<{
    title: string
    artistName: string
    notes: string[]
  }>
}

/**
 * Normalizes title and artist for comparison.
 */
export function normalizeSongKey(title: string, artist: string): string {
  const cleanTitle = (title || '').toLowerCase().replace(/[^a-z0-9]/gi, '').trim()
  const cleanArtist = (artist || '').toLowerCase().replace(/[^a-z0-9]/gi, '').trim()
  return `${cleanArtist}:::${cleanTitle}`
}

/**
 * Validates metadata and flags partial data, audio files, and licensing.
 */
export function validateOperatorTrack(raw: unknown): ValidatedOperatorTrack {
  const errors: string[] = []
  const partialNotes: string[] = []

  if (!raw || typeof raw !== 'object') {
    return {
      valid: false,
      title: 'Untitled',
      artistName: 'Unknown Artist',
      durationSeconds: 0,
      lyricsStatus: 'not_available',
      audioSourceType: 'none',
      isPlayable: false,
      hasAudioUpload: false,
      validationErrors: ['Input data bukan objek yang valid.'],
      isPartialData: true,
      partialNotes: ['data_kosong'],
    }
  }

  const item = raw as Record<string, unknown>
  const rawTitle = typeof item.title === 'string' ? item.title.trim() : ''
  const rawArtist = typeof item.artist === 'string'
    ? item.artist.trim()
    : typeof item.artistName === 'string'
      ? item.artistName.trim()
      : ''

  if (!rawTitle) {
    errors.push('Judul lagu (title) tidak boleh kosong.')
  }
  if (!rawArtist) {
    errors.push('Nama artis (artist) tidak boleh kosong.')
  }

  const albumName = typeof item.album === 'string' && item.album.trim()
    ? item.album.trim()
    : typeof item.albumName === 'string' && item.albumName.trim()
      ? item.albumName.trim()
      : undefined

  if (!albumName) {
    partialNotes.push('album_belum_diketahui')
  }

  const artworkUrl = typeof item.artworkUrl === 'string' && item.artworkUrl.trim()
    ? item.artworkUrl.trim()
    : undefined

  if (!artworkUrl) {
    partialNotes.push('artwork_belum_tersedia')
  }

  let durationSeconds = 0
  if (typeof item.durationSeconds === 'number' && !Number.isNaN(item.durationSeconds) && item.durationSeconds >= 0) {
    durationSeconds = Math.round(item.durationSeconds)
  } else {
    partialNotes.push('durasi_belum_diketahui')
  }

  // Lyrics handling: copyright compliance
  let lyricsStatus: 'not_available' | 'available' | 'partial' | 'licensing_required' = 'not_available'
  let lyricsSnippet: string | undefined
  let lyrics: string | undefined

  if (item.lyricsStatus === 'partial' || item.lyricsSnippet) {
    lyricsStatus = 'partial'
    lyricsSnippet = typeof item.lyricsSnippet === 'string' ? item.lyricsSnippet.trim() : undefined
  } else if (item.lyricsStatus === 'available' && typeof item.lyrics === 'string') {
    lyricsStatus = 'available'
    lyrics = item.lyrics.trim()
  }

  // Audio validation
  const audioFile = typeof item.audioFile === 'string' && item.audioFile.trim() ? item.audioFile.trim() : undefined
  const audioBuffer = item.audioBuffer instanceof Uint8Array
    ? item.audioBuffer
    : undefined
  const audioFileName = typeof item.audioFileName === 'string' ? item.audioFileName.trim() : undefined
  const rawSourceType = (item.audioSourceType as AudioSourceType) || 'none'
  const rawSourceUrl = typeof item.audioSourceUrl === 'string' ? item.audioSourceUrl.trim() : undefined
  const externalUrl = typeof item.externalUrl === 'string' ? item.externalUrl.trim() : undefined
  const storagePath = typeof item.storagePath === 'string' ? item.storagePath.trim() : undefined

  let audioSourceType: AudioSourceType = 'none'
  let audioSourceUrl: string | undefined = rawSourceUrl
  let isPlayable = false
  let hasAudioUpload = false

  if (audioFile || audioBuffer) {
    const fileNameToTest = audioFileName || audioFile || 'audio.mp3'
    const sizeToTest = audioBuffer ? audioBuffer.byteLength : 1000 // default size if file metadata not read yet

    const fileValidation = validateAudioFileMetadata({
      fileName: fileNameToTest,
      sizeBytes: sizeToTest,
    })

    if (!fileValidation.valid && fileValidation.error) {
      errors.push(fileValidation.error)
    } else {
      audioSourceType = 'storage'
      hasAudioUpload = true
      isPlayable = true
    }
  } else if (storagePath) {
    audioSourceType = 'storage'
    isPlayable = true
  } else if (rawSourceUrl) {
    const urlValidation = validateAudioSourceUrl(rawSourceUrl)
    if (!urlValidation.valid && urlValidation.error) {
      errors.push(urlValidation.error)
    } else if (rawSourceType === 'direct_stream') {
      audioSourceType = 'direct_stream'
      isPlayable = true
    } else {
      audioSourceType = urlValidation.audioSourceType
      isPlayable = urlValidation.isDirectPlayable
      if (!urlValidation.isDirectPlayable && urlValidation.error) {
        partialNotes.push('audio_eksternal_hanya_tautan')
      }
    }
  } else {
    audioSourceType = 'none'
    isPlayable = false
    partialNotes.push('audio_belum_tersedia')
  }

  return {
    valid: errors.length === 0,
    title: rawTitle || 'Untitled',
    artistName: rawArtist || 'Unknown Artist',
    albumName,
    artworkUrl,
    durationSeconds,
    lyricsStatus,
    lyricsSource: typeof item.lyricsSource === 'string' ? item.lyricsSource.trim() : undefined,
    lyricsSnippet,
    lyrics,
    audioSourceType,
    audioSourceUrl,
    audioFile,
    audioBuffer,
    audioFileName,
    storagePath,
    externalUrl,
    isPlayable,
    hasAudioUpload,
    validationErrors: errors,
    isPartialData: partialNotes.length > 0,
    partialNotes,
  }
}

/**
 * Executes operator bulk import workflow strictly obeying Supabase RLS.
 * Supports metadata-only and audio file uploads to Supabase Storage.
 * Max 11 tracks per batch.
 */
export async function executeOperatorImport(params: {
  supabase: SupabaseClient<Database>
  playlistId: string
  tracks: OperatorTrackInput[]
  bucketName?: string
}): Promise<OperatorBatchReport> {
  const { supabase, playlistId, tracks, bucketName = DEFAULT_AUDIO_BUCKET } = params

  const totalReceived = tracks.length
  const wasTruncated = totalReceived > MAX_OPERATOR_BATCH_SIZE
  const batch = wasTruncated ? tracks.slice(0, MAX_OPERATOR_BATCH_SIZE) : tracks
  const totalProcessed = batch.length

  const report: OperatorBatchReport = {
    timestamp: new Date().toISOString(),
    playlistId,
    batchLimit: MAX_OPERATOR_BATCH_SIZE,
    totalReceived,
    totalProcessed,
    wasTruncated,
    succeeded: [],
    duplicates: [],
    failed: [],
    needsCorrection: [],
  }

  // 1. Verify authenticated user
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) {
    throw new Error('Supabase authentication diperlukan untuk mengisi lagu. Pastikan operator telah login.')
  }
  const operatorUserId = authData.user.id

  // 2. Read existing tracks from target playlist (RLS check)
  const { data: existingTracks, error: playlistReadError } = await supabase
    .from('playlist_tracks')
    .select('id, title, artist_name, position, provider_track_id')
    .eq('playlist_id', playlistId)
    .order('position', { ascending: false })

  if (playlistReadError) {
    throw new Error(`Gagal membaca playlist tujuan (${playlistReadError.message}). Periksa apakah playlist ID valid dan Anda memiliki izin akses (RLS).`)
  }

  const existingKeys = new Set<string>()
  let currentMaxPosition = 0

  if (existingTracks && existingTracks.length > 0) {
    currentMaxPosition = Number(existingTracks[0].position) || 0
    for (const t of existingTracks) {
      existingKeys.add(normalizeSongKey(t.title, t.artist_name))
    }
  }

  // 3. Validate tracks and detect duplicates BEFORE audio upload
  const seenBatchKeys = new Set<string>()
  const validTracksToProcess: Array<{
    validated: ValidatedOperatorTrack
    position: number
    providerTrackId: string
  }> = []

  let nextPosition = currentMaxPosition + 1000.0

  for (const rawTrack of batch) {
    const validated = validateOperatorTrack(rawTrack)

    if (!validated.valid) {
      report.failed.push({
        title: validated.title,
        artistName: validated.artistName,
        errors: validated.validationErrors,
      })
      continue
    }

    if (validated.isPartialData) {
      report.needsCorrection.push({
        title: validated.title,
        artistName: validated.artistName,
        notes: validated.partialNotes,
      })
    }

    const key = normalizeSongKey(validated.title, validated.artistName)

    if (seenBatchKeys.has(key)) {
      report.duplicates.push({
        title: validated.title,
        artistName: validated.artistName,
        reason: 'duplicate_in_batch',
      })
      continue
    }
    seenBatchKeys.add(key)

    if (existingKeys.has(key)) {
      report.duplicates.push({
        title: validated.title,
        artistName: validated.artistName,
        reason: 'duplicate_in_target_playlist',
      })
      continue
    }

    const providerTrackId = `orb_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
    validTracksToProcess.push({
      validated,
      position: nextPosition,
      providerTrackId,
    })
    nextPosition += 1000.0
  }

  if (validTracksToProcess.length === 0) {
    return report
  }

  // 4. Process audio uploads for valid, non-duplicate tracks
  const rowsToInsert: Array<{
    playlist_id: string
    provider: string
    provider_track_id: string
    title: string
    artist_name: string
    album_name: string | null
    artwork_url: string | null
    duration_seconds: number
    position: number
    added_by: string
    added_via: 'ai_cli'
    verification_status: 'unverified'
    audio_url: string | null
    storage_path: string | null
    audio_source_type: AudioSourceType
  }> = []

  for (const item of validTracksToProcess) {
    let finalStoragePath: string | null = item.validated.storagePath || null
    let finalAudioUrl: string | null = item.validated.audioSourceUrl || null
    let finalSourceType: AudioSourceType = item.validated.audioSourceType

    // If track has an audio buffer or file, upload to Supabase Storage
    if (item.validated.hasAudioUpload && (item.validated.audioBuffer || item.validated.audioFile)) {
      const fileData: Blob | Uint8Array | null = item.validated.audioBuffer || null
      const fileName = item.validated.audioFileName || item.validated.audioFile || `${item.providerTrackId}.mp3`

      // If file path was provided without an in-memory buffer, file reading must occur at the CLI / caller level
      if (!fileData && item.validated.audioFile) {
        report.failed.push({
          title: item.validated.title,
          artistName: item.validated.artistName,
          errors: ['Pengunggahan file audio memerlukan audioBuffer (Uint8Array/Blob). Pembacaan file path disk dilakukan di level CLI.'],
        })
        continue
      }

      if (fileData && supabase.storage) {
        const uploadResult = await uploadTrackAudioToSupabase({
          supabase,
          playlistId,
          trackId: item.providerTrackId,
          fileData,
          fileName,
          bucketName,
        })

        if (uploadResult.error || !uploadResult.storagePath) {
          report.failed.push({
            title: item.validated.title,
            artistName: item.validated.artistName,
            errors: [`Gagal mengunggah file audio ke Storage: ${uploadResult.error?.message || 'Upload error'}`],
          })
          continue
        }

        finalStoragePath = uploadResult.storagePath
        finalAudioUrl = uploadResult.publicUrl
        finalSourceType = 'storage'
      }
    }

    rowsToInsert.push({
      playlist_id: playlistId,
      provider: 'orbim',
      provider_track_id: item.providerTrackId,
      title: item.validated.title,
      artist_name: item.validated.artistName,
      album_name: item.validated.albumName || null,
      artwork_url: item.validated.artworkUrl || null,
      duration_seconds: item.validated.durationSeconds,
      position: item.position,
      added_by: operatorUserId,
      added_via: 'ai_cli',
      verification_status: 'unverified',
      audio_url: finalAudioUrl,
      storage_path: finalStoragePath,
      audio_source_type: finalSourceType,
    })
  }

  if (rowsToInsert.length === 0) {
    return report
  }

  // 5. Save to database using Supabase RLS
  const { error: insertError } = await supabase
    .from('playlist_tracks')
    .insert(rowsToInsert as any)

  if (insertError) {
    throw new Error(`Gagal menyimpan lagu ke database: ${insertError.message}`)
  }

  // 6. Re-read and verify saved tracks from database
  const insertedTrackIds = rowsToInsert.map((r) => r.provider_track_id)
  const { data: verifiedRows, error: verifyError } = await supabase
    .from('playlist_tracks')
    .select('id, title, artist_name, position, provider_track_id, verification_status, added_via, audio_url, storage_path, audio_source_type')
    .eq('playlist_id', playlistId)
    .in('provider_track_id', insertedTrackIds)

  if (verifyError || !verifiedRows) {
    throw new Error(`Penyimpanan selesai namun verifikasi ulang gagal: ${verifyError?.message || 'Data tidak ditemukan'}`)
  }

  const verifiedMap = new Map((verifiedRows as any[]).map((r) => [r.provider_track_id, r]))

  for (const insertedRow of rowsToInsert) {
    const verifiedRow = verifiedMap.get(insertedRow.provider_track_id)
    const hasAudio = Boolean(verifiedRow?.audio_url || verifiedRow?.storage_path)

    report.succeeded.push({
      id: verifiedRow?.id,
      title: insertedRow.title,
      artistName: insertedRow.artist_name,
      position: insertedRow.position,
      verified: Boolean(verifiedRow),
      verificationStatus: verifiedRow?.verification_status as 'unverified' | 'verified' | 'rejected',
      addedVia: verifiedRow?.added_via as 'web_ui' | 'ai_cli' | 'bulk_import' | 'system',
      hasAudio,
      isPlayable: hasAudio && verifiedRow?.audio_source_type !== 'external_url',
      audioSourceType: (verifiedRow?.audio_source_type as AudioSourceType) || insertedRow.audio_source_type,
      audioUrl: verifiedRow?.audio_url || insertedRow.audio_url,
      storagePath: verifiedRow?.storage_path || insertedRow.storage_path,
    })
  }

  return report
}
