import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseConfig, isSupabaseConfigured, supabase } from '../../lib/supabase.ts'
import type { Database } from '../../types/database.ts'
import type { AudioSourceType } from '../../types/music.ts'

export const DEFAULT_AUDIO_BUCKET = 'track-audio'
export const MAX_AUDIO_FILE_SIZE_BYTES = 52_428_800 // 50 MB
export const MIN_AUDIO_FILE_SIZE_BYTES = 100 // 100 Bytes

export const SUPPORTED_AUDIO_EXTENSIONS: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
}

/**
 * Platforms requiring proprietary embedding or licensing where downloading/ripping is disallowed.
 */
export const DISALLOWED_STREAM_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'spotify.com',
  'open.spotify.com',
  'soundcloud.com',
  'music.apple.com',
  'tidal.com',
  'deezer.com',
]

/**
 * Extracts and maps file extension to standard audio MIME type.
 */
export function getAudioMimeType(fileNameOrPath: string): string | null {
  const clean = fileNameOrPath.toLowerCase().trim()
  const dotIdx = clean.lastIndexOf('.')
  if (dotIdx === -1) return null
  const ext = clean.substring(dotIdx)
  return SUPPORTED_AUDIO_EXTENSIONS[ext] || null
}

export interface AudioValidationResult {
  valid: boolean
  mimeType?: string
  extension?: string
  error?: string
}

/**
 * Validates audio file constraints (extension, MIME type, size bounds).
 */
export function validateAudioFileMetadata(params: {
  fileName: string
  sizeBytes: number
  maxSizeBytes?: number
}): AudioValidationResult {
  const { fileName, sizeBytes, maxSizeBytes = MAX_AUDIO_FILE_SIZE_BYTES } = params

  if (!fileName || typeof fileName !== 'string' || !fileName.trim()) {
    return { valid: false, error: 'Nama file audio tidak boleh kosong.' }
  }

  const clean = fileName.trim().toLowerCase()
  const dotIdx = clean.lastIndexOf('.')
  if (dotIdx === -1) {
    return {
      valid: false,
      error: `File "${fileName}" tidak memiliki ekstensi. Ekstensi yang didukung: ${Object.keys(SUPPORTED_AUDIO_EXTENSIONS).join(', ')}`,
    }
  }

  const ext = clean.substring(dotIdx)
  const mimeType = SUPPORTED_AUDIO_EXTENSIONS[ext]
  if (!mimeType) {
    return {
      valid: false,
      error: `Format audio "${ext}" tidak didukung. Harap gunakan format: ${Object.keys(SUPPORTED_AUDIO_EXTENSIONS).join(', ')}`,
    }
  }

  if (sizeBytes < MIN_AUDIO_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `Ukuran file audio terlalu kecil (${sizeBytes} bytes). File kemungkinan kosong atau rusak.`,
    }
  }

  if (sizeBytes > maxSizeBytes) {
    const maxMb = (maxSizeBytes / (1024 * 1024)).toFixed(1)
    const fileMb = (sizeBytes / (1024 * 1024)).toFixed(1)
    return {
      valid: false,
      error: `Ukuran file audio (${fileMb} MB) melebihi batas maksimum (${maxMb} MB).`,
    }
  }

  return { valid: true, mimeType, extension: ext }
}

export interface AudioUrlValidationResult {
  valid: boolean
  audioSourceType: AudioSourceType
  isDirectPlayable: boolean
  error?: string
}

/**
 * Validates external audio URLs, blocking unauthorized streaming/ripping targets.
 */
export function validateAudioSourceUrl(url: string): AudioUrlValidationResult {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return { valid: false, audioSourceType: 'none', isDirectPlayable: false, error: 'URL audio tidak boleh kosong.' }
  }

  const cleanUrl = url.trim()

  let parsed: URL
  try {
    parsed = new URL(cleanUrl)
  } catch {
    return { valid: false, audioSourceType: 'none', isDirectPlayable: false, error: 'Format URL tidak valid.' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      audioSourceType: 'none',
      isDirectPlayable: false,
      error: 'Protokol URL harus HTTP atau HTTPS.',
    }
  }

  // Check for disallowed scraping / copyright-restricted streaming services
  const hostname = parsed.hostname.toLowerCase()
  const isDisallowed = DISALLOWED_STREAM_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  )

  if (isDisallowed) {
    return {
      valid: false,
      audioSourceType: 'none',
      isDirectPlayable: false,
      error: `Pengambilan atau pengunduhan audio dari ${hostname} dilarang karena hak cipta. Gunakan tautan stream langsung berlisensi Creative Commons atau domain publik.`,
    }
  }

  // Check if pathname points directly to an audio file
  const pathname = parsed.pathname.toLowerCase()
  const hasAudioExt = Object.keys(SUPPORTED_AUDIO_EXTENSIONS).some((ext) => pathname.endsWith(ext))

  if (hasAudioExt) {
    return {
      valid: true,
      audioSourceType: 'direct_stream',
      isDirectPlayable: true,
    }
  }

  // If it's a webpage / informational URL, it cannot be fed directly to HTML5 <audio>
  return {
    valid: true,
    audioSourceType: 'external_url',
    isDirectPlayable: false,
    error: 'URL merupakan tautan eksternal (bukan stream file audio langsung). Lagu disimpan sebagai referensi metadata tanpa pemutaran native.',
  }
}

export interface AudioUploadResult {
  storagePath: string | null
  publicUrl: string | null
  error: Error | null
}

/**
 * Uploads an audio file buffer to Supabase Storage.
 * Uses the authenticated operator session (least-privileged).
 */
export async function uploadTrackAudioToSupabase(params: {
  supabase: SupabaseClient<Database>
  playlistId: string
  trackId: string
  fileData: Blob | Uint8Array
  fileName: string
  bucketName?: string
}): Promise<AudioUploadResult> {
  const {
    supabase,
    playlistId,
    trackId,
    fileData,
    fileName,
    bucketName = DEFAULT_AUDIO_BUCKET,
  } = params

  const clean = fileName.trim().toLowerCase()
  const dotIdx = clean.lastIndexOf('.')
  const ext = dotIdx !== -1 ? clean.substring(dotIdx) : '.mp3'
  const mimeType = SUPPORTED_AUDIO_EXTENSIONS[ext] || 'audio/mpeg'

  // Standardized safe path avoiding directory traversal
  const sanitizedPlaylistId = playlistId.replace(/[^a-zA-Z0-9_-]/g, '')
  const sanitizedTrackId = trackId.replace(/[^a-zA-Z0-9_-]/g, '')
  const storagePath = `${sanitizedPlaylistId}/${sanitizedTrackId}${ext}`

  try {
    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(storagePath, fileData, {
        contentType: mimeType,
        upsert: true,
      })

    if (uploadError) {
      return {
        storagePath: null,
        publicUrl: null,
        error: new Error(`Gagal mengunggah file audio ke Supabase Storage: ${uploadError.message}`),
      }
    }

    const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(storagePath)

    return {
      storagePath,
      publicUrl: urlData.publicUrl,
      error: null,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      storagePath: null,
      publicUrl: null,
      error: new Error(`Exception saat mengunggah file audio: ${msg}`),
    }
  }
}

/**
 * Canonical helper that derives the public Supabase Storage CDN URL for any storage_path.
 * Guarantees that any track with a storage_path yields a valid playback URL.
 * Works seamlessly whether an explicit client is provided, proxy is configured, or in offline/test environments.
 */
export function resolveStoragePublicUrl(
  storagePath?: string | null,
  bucketName = DEFAULT_AUDIO_BUCKET,
  supabaseClient?: SupabaseClient<any>,
): string | undefined {
  if (!storagePath || typeof storagePath !== 'string' || !storagePath.trim()) return undefined
  const cleanPath = storagePath.trim()
  if (cleanPath.startsWith('http://') || cleanPath.startsWith('https://')) {
    return cleanPath
  }

  // 1. If explicit client provided
  if (supabaseClient) {
    try {
      const { data } = supabaseClient.storage.from(bucketName).getPublicUrl(cleanPath)
      if (data?.publicUrl) return data.publicUrl
    } catch {
      // fallback
    }
  }

  // 2. Try singleton proxy client if configured
  try {
    if (isSupabaseConfigured()) {
      const { data } = supabase.storage.from(bucketName).getPublicUrl(cleanPath)
      if (data?.publicUrl) return data.publicUrl
    }
  } catch {
    // fallback
  }

  // 3. Fallback to canonical URL construction
  let baseUrl = 'https://rprrvdyugakkpittzvjv.supabase.co'
  try {
    if (isSupabaseConfigured()) {
      baseUrl = getSupabaseConfig().supabaseUrl
    }
  } catch {
    // fallback
  }
  return `${baseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${bucketName}/${cleanPath.replace(/^\/+/, '')}`
}

/**
 * Resolves whether a database track row provides a playable HTML5 audio stream URL.
 */
export function resolveTrackAudioPlayback(
  track: {
    audio_url?: string | null
    storage_path?: string | null
    audio_source_type?: string | null
  },
  supabaseClient?: SupabaseClient<any>,
  bucketName = DEFAULT_AUDIO_BUCKET,
): {
  isPlayable: boolean
  playbackUrl?: string
  audioSourceType: AudioSourceType
} {
  // 1. If storage_path is present, always resolve its canonical Supabase public CDN URL
  if (track.storage_path) {
    const publicUrl = resolveStoragePublicUrl(track.storage_path, bucketName, supabaseClient)
    if (publicUrl) {
      return {
        isPlayable: true,
        playbackUrl: publicUrl,
        audioSourceType: 'storage',
      }
    }
  }

  // 2. Explicit external informational URLs are never direct native audio streams
  if (track.audio_source_type === 'external_url') {
    return {
      isPlayable: false,
      playbackUrl: undefined,
      audioSourceType: 'external_url',
    }
  }

  // 3. Direct public HTTP/HTTPS stream URL (pre-saved audio_url or direct_stream)
  if (track.audio_url && track.audio_url.startsWith('http')) {
    return {
      isPlayable: true,
      playbackUrl: track.audio_url,
      audioSourceType: (track.audio_source_type as AudioSourceType) || 'storage',
    }
  }

  if (track.audio_url && track.audio_source_type === 'direct_stream') {
    return {
      isPlayable: true,
      playbackUrl: track.audio_url,
      audioSourceType: 'direct_stream',
    }
  }

  return {
    isPlayable: false,
    playbackUrl: undefined,
    audioSourceType: 'none',
  }
}
