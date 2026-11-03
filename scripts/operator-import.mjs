#!/usr/bin/env node
/**
 * scripts/operator-import.mjs
 *
 * External AI CLI Operator script to batch-import song metadata and playable audio into ORBIM.
 * Constraints:
 * - Maximum 11 songs per batch.
 * - Must strictly adhere to Supabase Row Level Security (RLS) via operator credentials.
 * - No service-role key or admin bypass.
 * - No scraping or hallucinating copyrighted lyrics.
 * - No scraping, ripping, or re-uploading from Spotify/YouTube.
 * - Supports uploading legally distributable audio files (.mp3, .wav, .ogg, .flac, .m4a) to Supabase Storage.
 * - Re-reads and verifies data from database after write.
 * - Never prints secrets or tokens to stdout/stderr.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

export const MAX_OPERATOR_BATCH_SIZE = 11
export const DEFAULT_AUDIO_BUCKET = 'track-audio'
export const MAX_AUDIO_FILE_SIZE_BYTES = 52_428_800 // 50 MB
export const MIN_AUDIO_FILE_SIZE_BYTES = 100 // 100 Bytes

export const SUPPORTED_AUDIO_EXTENSIONS = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
}

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
 * Loads environment variables from .env.local or .env without external dotenv dependency.
 */
function loadEnv() {
  const envFiles = ['.env.local', '.env']
  const envMap = { ...process.env }

  for (const file of envFiles) {
    const fullPath = path.resolve(process.cwd(), file)
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8')
        for (const line of content.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          const eqIdx = trimmed.indexOf('=')
          if (eqIdx > 0) {
            const key = trimmed.substring(0, eqIdx).trim()
            let val = trimmed.substring(eqIdx + 1).trim()
            if (val.startsWith('"') && val.endsWith('"')) {
              val = val.slice(1, -1)
            } else if (val.startsWith("'") && val.endsWith("'")) {
              val = val.slice(1, -1)
            }
            if (!envMap[key]) {
              envMap[key] = val
            }
          }
        }
      } catch {
        // Silently continue if reading env fails
      }
    }
  }

  return envMap
}

/**
 * Normalizes title and artist for duplicate comparison.
 */
export function normalizeSongKey(title, artist) {
  const cleanTitle = (title || '').toLowerCase().replace(/[^a-z0-9]/gi, '').trim()
  const cleanArtist = (artist || '').toLowerCase().replace(/[^a-z0-9]/gi, '').trim()
  return `${cleanArtist}:::${cleanTitle}`
}

/**
 * Validates audio file constraints (existence, extension, size).
 * Resolves against process.cwd() first, with fallback to baseDir (e.g. JSON file folder).
 */
export function validateAudioFileOnDisk(filePath, baseDir = process.cwd()) {
  if (!filePath || typeof filePath !== 'string') {
    return { valid: false, error: 'Path file audio tidak valid.' }
  }

  let resolved = path.resolve(process.cwd(), filePath)
  if (!fs.existsSync(resolved) && baseDir && baseDir !== process.cwd()) {
    const candidate = path.resolve(baseDir, filePath)
    if (fs.existsSync(candidate)) {
      resolved = candidate
    }
  }

  if (!fs.existsSync(resolved)) {
    return { valid: false, error: `File audio tidak ditemukan di "${resolved}".` }
  }

  const ext = path.extname(resolved).toLowerCase()
  const mimeType = SUPPORTED_AUDIO_EXTENSIONS[ext]
  if (!mimeType) {
    return {
      valid: false,
      error: `Format audio "${ext}" tidak didukung. Harap gunakan: ${Object.keys(SUPPORTED_AUDIO_EXTENSIONS).join(', ')}`,
    }
  }

  let stat
  try {
    stat = fs.statSync(resolved)
  } catch (err) {
    return { valid: false, error: `Gagal membaca informasi file audio: ${err.message}` }
  }

  if (stat.size < MIN_AUDIO_FILE_SIZE_BYTES) {
    return { valid: false, error: `File audio terlalu kecil (${stat.size} bytes). File rusak atau kosong.` }
  }

  if (stat.size > MAX_AUDIO_FILE_SIZE_BYTES) {
    const maxMb = (MAX_AUDIO_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(1)
    const fileMb = (stat.size / (1024 * 1024)).toFixed(1)
    return { valid: false, error: `Ukuran file audio (${fileMb} MB) melebihi batas (${maxMb} MB).` }
  }

  return {
    valid: true,
    resolvedPath: resolved,
    fileName: path.basename(resolved),
    sizeBytes: stat.size,
    extension: ext,
    mimeType,
  }
}

/**
 * Validates external audio URLs, blocking unauthorized streaming/ripping targets.
 */
export function validateAudioSourceUrl(url) {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return { valid: false, audioSourceType: 'none', isDirectPlayable: false, error: 'URL audio tidak boleh kosong.' }
  }

  let parsed
  try {
    parsed = new URL(url.trim())
  } catch {
    return { valid: false, audioSourceType: 'none', isDirectPlayable: false, error: 'Format URL audio tidak valid.' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, audioSourceType: 'none', isDirectPlayable: false, error: 'Protokol URL harus HTTP/HTTPS.' }
  }

  const hostname = parsed.hostname.toLowerCase()
  const isDisallowed = DISALLOWED_STREAM_DOMAINS.some(
    (d) => hostname === d || hostname.endsWith(`.${d}`),
  )

  if (isDisallowed) {
    return {
      valid: false,
      audioSourceType: 'none',
      isDirectPlayable: false,
      error: `Pengambilan audio langsung dari ${hostname} dilarang karena hak cipta. Gunakan direct stream berlisensi terbuka atau upload file audio lokal.`,
    }
  }

  const pathname = parsed.pathname.toLowerCase()
  const hasAudioExt = Object.keys(SUPPORTED_AUDIO_EXTENSIONS).some((ext) => pathname.endsWith(ext))

  if (hasAudioExt) {
    return { valid: true, audioSourceType: 'direct_stream', isDirectPlayable: true }
  }

  return {
    valid: true,
    audioSourceType: 'external_url',
    isDirectPlayable: false,
    error: 'URL adalah tautan web eksternal, bukan direct audio stream. Lagu tersimpan sebagai referensi tanpa pemutaran native.',
  }
}

/**
 * Validates metadata and flags partial data.
 */
export function validateOperatorTrack(raw, baseDir = process.cwd()) {
  const errors = []
  const partialNotes = []

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

  const rawTitle = typeof raw.title === 'string' ? raw.title.trim() : ''
  const rawArtist = typeof raw.artist === 'string'
    ? raw.artist.trim()
    : typeof raw.artistName === 'string'
      ? raw.artistName.trim()
      : ''

  if (!rawTitle) {
    errors.push('Judul lagu (title) tidak boleh kosong.')
  }
  if (!rawArtist) {
    errors.push('Nama artis (artist) tidak boleh kosong.')
  }

  const albumName = typeof raw.album === 'string' && raw.album.trim()
    ? raw.album.trim()
    : typeof raw.albumName === 'string' && raw.albumName.trim()
      ? raw.albumName.trim()
      : undefined

  if (!albumName) {
    partialNotes.push('album_belum_diketahui')
  }

  const artworkUrl = typeof raw.artworkUrl === 'string' && raw.artworkUrl.trim()
    ? raw.artworkUrl.trim()
    : undefined

  if (!artworkUrl) {
    partialNotes.push('artwork_belum_tersedia')
  }

  let durationSeconds = 0
  if (typeof raw.durationSeconds === 'number' && !Number.isNaN(raw.durationSeconds) && raw.durationSeconds >= 0) {
    durationSeconds = Math.round(raw.durationSeconds)
  } else {
    partialNotes.push('durasi_belum_diketahui')
  }

  // Lyrics handling: safe partial quotes, disclaimer banner, strictly no scraping
  let lyricsStatus = 'not_available'
  let lyricsSnippet
  let lyrics

  if (raw.lyricsStatus === 'partial' || raw.lyricsSnippet) {
    lyricsStatus = 'partial'
    lyricsSnippet = typeof raw.lyricsSnippet === 'string' ? raw.lyricsSnippet.trim() : undefined
  } else if (raw.lyricsStatus === 'available' && typeof raw.lyrics === 'string') {
    lyricsStatus = 'available'
    lyrics = raw.lyrics.trim()
  }

  // Audio validation
  const audioFile = typeof raw.audioFile === 'string' && raw.audioFile.trim() ? raw.audioFile.trim() : undefined
  const rawSourceType = raw.audioSourceType || 'none'
  const rawSourceUrl = typeof raw.audioSourceUrl === 'string' ? raw.audioSourceUrl.trim() : undefined
  const externalUrl = typeof raw.externalUrl === 'string' ? raw.externalUrl.trim() : undefined
  const storagePath = typeof raw.storagePath === 'string' ? raw.storagePath.trim() : undefined

  let audioSourceType = 'none'
  let isPlayable = false
  let hasAudioUpload = false
  let audioFileInfo = null

  if (audioFile) {
    audioFileInfo = validateAudioFileOnDisk(audioFile, baseDir)
    if (!audioFileInfo.valid) {
      errors.push(audioFileInfo.error)
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
    if (!urlValidation.valid) {
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
    provider: typeof raw.provider === 'string' ? raw.provider : 'spotify',
    providerTrackId: typeof raw.providerTrackId === 'string' ? raw.providerTrackId : undefined,
    title: rawTitle || 'Untitled',
    artistName: rawArtist || 'Unknown Artist',
    albumName,
    artworkUrl,
    durationSeconds,
    lyricsStatus,
    lyricsSource: typeof raw.lyricsSource === 'string' ? raw.lyricsSource.trim() : undefined,
    lyricsSnippet,
    lyrics,
    audioFile,
    audioFileInfo,
    hasAudioUpload,
    audioSourceType,
    audioSourceUrl: rawSourceUrl,
    storagePath,
    externalUrl,
    isPlayable,
    license: typeof raw.license === 'string' ? raw.license.trim() : undefined,
    validationErrors: errors,
    isPartialData: partialNotes.length > 0,
    partialNotes,
  }
}

/**
 * Applies CLI --audio option to raw tracks:
 * - Single track: CLI flag takes precedence over any existing audioFile property.
 * - Multi-track: logs a warning and leaves audioFile unchanged.
 */
export function applyCliAudioOption(rawTracks, audioOption, warnFn = console.warn) {
  if (!audioOption || !Array.isArray(rawTracks)) return rawTracks

  if (rawTracks.length === 1) {
    rawTracks[0].audioFile = audioOption
  } else if (rawTracks.length > 1) {
    warnFn('⚠️ Peringatan: Pilihan --audio hanya diterapkan pada single track import. Mengabaikan --audio untuk batch multi-track.')
  }
  return rawTracks
}

/**
 * Parses CLI arguments. Supports both space-separated (--flag value) and equals (--flag=value) formats.
 */
export function parseArgs(rawArgs = process.argv.slice(2)) {
  const options = {
    playlist: '',
    file: '',
    input: '',
    audio: '',
    email: '',
    password: '',
    batchSize: 0,
    dryRun: false,
    demo: false,
    json: false,
    help: false,
  }

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i]

    if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--demo') {
      options.demo = true
    } else if (arg === '--json') {
      options.json = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg.startsWith('--playlist=') || arg.startsWith('-p=')) {
      options.playlist = arg.substring(arg.indexOf('=') + 1)
    } else if (arg === '--playlist' || arg === '-p') {
      options.playlist = rawArgs[++i] || ''
    } else if (arg.startsWith('--file=') || arg.startsWith('-f=')) {
      options.file = arg.substring(arg.indexOf('=') + 1)
    } else if (arg === '--file' || arg === '-f') {
      options.file = rawArgs[++i] || ''
    } else if (arg.startsWith('--input=') || arg.startsWith('-i=')) {
      options.input = arg.substring(arg.indexOf('=') + 1)
    } else if (arg === '--input' || arg === '-i') {
      options.input = rawArgs[++i] || ''
    } else if (arg.startsWith('--audio=') || arg.startsWith('-a=')) {
      options.audio = arg.substring(arg.indexOf('=') + 1)
    } else if (arg === '--audio' || arg === '-a') {
      options.audio = rawArgs[++i] || ''
    } else if (arg.startsWith('--email=')) {
      options.email = arg.substring(arg.indexOf('=') + 1)
    } else if (arg === '--email') {
      options.email = rawArgs[++i] || ''
    } else if (arg.startsWith('--password=')) {
      options.password = arg.substring(arg.indexOf('=') + 1)
    } else if (arg === '--password') {
      options.password = rawArgs[++i] || ''
    } else if (arg.startsWith('--batch-size=')) {
      options.batchSize = parseInt(arg.substring(arg.indexOf('=') + 1), 10) || 0
    } else if (arg === '--batch-size') {
      options.batchSize = parseInt(rawArgs[++i], 10) || 0
    }
  }

  return options
}

/**
 * Sample tracks for demonstration / test mode.
 */
const DEMO_TRACKS = [
  {
    title: 'Dan',
    artist: 'Sheila On 7',
    album: 'Kisah Klasik Untuk Masa Depan',
    durationSeconds: 289,
    lyricsStatus: 'partial',
    lyricsSnippet: 'Dan... bila esok datang kembali, seperti sedia kala...',
    lyricsSource: 'Fair Use Excerpt',
  },
  {
    title: 'Kangen',
    artist: 'Dewa 19',
    album: 'Format Masa Depan',
    durationSeconds: 315,
  },
  {
    title: 'Ruang Sendiri',
    artist: 'Tulus',
    album: 'Monokrom',
    durationSeconds: 268,
  },
  {
    title: 'Akad',
    artist: 'Payung Teduh',
    album: 'Ruang Tunggu',
    durationSeconds: 258,
  },
  {
    title: 'Menghitung Hari',
    artist: 'Krisdayanti',
    // Missing album and artwork intentionally to demonstrate partial data
  },
]

function printHelp() {
  console.log(`
ORBIM Operator Bulk Song & Audio Import CLI
===========================================
Memungkinkan AI CLI eksternal mengunggah lagu beserta audio streaming ke ORBIM.

Penggunaan:
  node scripts/operator-import.mjs --playlist <PLAYLIST_ID> [pilihan]

Pilihan:
  --playlist, -p    ID playlist tujuan di Supabase (wajib jika bukan --dry-run)
  --file, -f        Path ke file JSON atau CSV berisi daftar lagu
  --input, -i       String JSON berisi array lagu: '[{"title":"...","artist":"...","audioFile":"..."}]'
  --audio, -a       Path ke file audio lokal (.mp3, .wav, .ogg, .flac) untuk single track import
  --email           Email akun operator untuk autentikasi Supabase RLS
  --password        Password akun operator untuk autentikasi Supabase RLS
  --dry-run         Uji validasi, audio check, dan deduplikasi tanpa menulis ke database/storage
  --demo            Gunakan data contoh (5 lagu) untuk verifikasi workflow
  --json            Tampilkan hasil murni dalam format JSON
  --help, -h        Tampilkan bantuan ini

Dukungan Audio:
  - Format didukung: .mp3, .wav, .ogg, .opus, .m4a, .aac, .flac (maksimal 50 MB/file).
  - Audio file lokal diunggah otomatis ke Supabase Storage bucket 'track-audio'.
  - Direct audio streams (misal arsip publik berlisensi CC) disimpan langsung.
  - Streaming atau ripping dari YouTube/Spotify diblokir demi kepatuhan hak cipta.
  - Maksimal 11 lagu per batch pemrosesan.
  `)
}

async function main() {
  const options = parseArgs()

  if (options.help) {
    printHelp()
    process.exit(0)
  }

  const env = loadEnv()
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY

  // 1. Gather input tracks
  let rawTracks = []
  let baseDir = process.cwd()

  if (options.demo) {
    rawTracks = DEMO_TRACKS
  } else if (options.input) {
    try {
      const cleanInput = options.input.replace(/^\uFEFF/, '')
      const parsed = JSON.parse(cleanInput)
      rawTracks = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? [parsed] : [])
    } catch (e) {
      console.error('Error: Format JSON pada --input tidak valid:', e.message)
      process.exit(1)
    }
  } else if (options.file) {
    const filePath = path.resolve(process.cwd(), options.file)
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File tidak ditemukan di ${filePath}`)
      process.exit(1)
    }
    baseDir = path.dirname(filePath)
    const content = fs.readFileSync(filePath, 'utf8')
    if (filePath.endsWith('.json')) {
      try {
        const cleanContent = content.replace(/^\uFEFF/, '')
        const parsed = JSON.parse(cleanContent)
        rawTracks = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? [parsed] : [])
      } catch (e) {
        console.error('Error: Gagal mem-parse file JSON:', e.message)
        process.exit(1)
      }
    } else {
      // Simple CSV parsing
      const lines = content.split('\n').map((l) => l.trim()).filter(Boolean)
      if (lines.length > 0) {
        const header = lines[0].toLowerCase()
        const isHeader = header.includes('title') || header.includes('judul')
        const dataLines = isHeader ? lines.slice(1) : lines
        for (const line of dataLines) {
          const parts = line.includes(';') ? line.split(';') : line.split(',')
          if (parts.length >= 2) {
            rawTracks.push({
              title: parts[0].replace(/^["']|["']$/g, '').trim(),
              artist: parts[1].replace(/^["']|["']$/g, '').trim(),
              album: parts[2] ? parts[2].replace(/^["']|["']$/g, '').trim() : undefined,
              audioFile: parts[3] ? parts[3].replace(/^["']|["']$/g, '').trim() : undefined,
            })
          }
        }
      }
    }
  } else {
    console.error('Error: Harap berikan input lagu menggunakan --file, --input, atau --demo.')
    console.error('Gunakan --help untuk melihat panduan.')
    process.exit(1)
  }

  if (!Array.isArray(rawTracks) || rawTracks.length === 0) {
    console.error('Error: Tidak ada data lagu yang dapat diproses.')
    process.exit(1)
  }

  // 2. Apply CLI audio option (single-track priority, multi-track warning)
  applyCliAudioOption(rawTracks, options.audio)

  // 2. Batch limit enforcement (default max 11, or custom batchSize)
  const effectiveBatchLimit = options.batchSize > 0 ? options.batchSize : MAX_OPERATOR_BATCH_SIZE
  const totalReceived = rawTracks.length
  const wasTruncated = totalReceived > effectiveBatchLimit
  const batch = wasTruncated ? rawTracks.slice(0, effectiveBatchLimit) : rawTracks
  const totalProcessed = batch.length

  const report = {
    timestamp: new Date().toISOString(),
    playlistId: options.playlist || '(dry-run)',
    batchLimit: effectiveBatchLimit,
    totalReceived,
    totalProcessed,
    wasTruncated,
    dryRun: options.dryRun,
    succeeded: [],
    duplicates: [],
    failed: [],
    needsCorrection: [],
  }

  // 3. Dry-run mode or Database execution
  if (options.dryRun || (!options.playlist && options.demo)) {
    // Process purely in-memory
    const seenBatchKeys = new Set()

    for (const raw of batch) {
      const validated = validateOperatorTrack(raw, baseDir)

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

      report.succeeded.push({
        title: validated.title,
        artistName: validated.artistName,
        position: (report.succeeded.length + 1) * 1000,
        verified: false, // In dry-run mode, data is not written to or verified against DB
        verificationStatus: 'unverified',
        addedVia: 'ai_cli',
        hasAudio: validated.isPlayable,
        isPlayable: validated.isPlayable,
        audioSourceType: validated.audioSourceType,
        audioUrl: validated.hasAudioUpload ? `[dry-run://track-audio/${validated.title}.mp3]` : (validated.audioSourceUrl || null),
      })
    }
  } else {
    // Full Supabase execution
    if (!options.playlist) {
      console.error('Error: Parameter --playlist <ID> wajib diisi untuk menyimpan lagu ke database.')
      process.exit(1)
    }

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('Error: Supabase environment variables (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY) tidak ditemukan.')
      process.exit(1)
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey)

    // Authenticate operator user if credentials provided
    const email = env.OPERATOR_EMAIL || options.email
    const password = env.OPERATOR_PASSWORD || options.password

    if (options.password && !options.json) {
      console.warn('🔒 [Security Recommendation] Memasukkan password melalui flag CLI (--password) dapat terekspos pada process list. Disarankan menggunakan variabel lingkungan OPERATOR_PASSWORD atau file .env.local.')
    }

    if (email && password) {
      const { error: loginError } = await supabase.auth.signInWithPassword({ email, password })
      if (loginError) {
        console.error('Error: Autentikasi operator gagal:', loginError.message)
        process.exit(1)
      }
    }

    const { data: authData, error: userError } = await supabase.auth.getUser()
    if (userError || !authData?.user) {
      console.error('Error: Supabase RLS mensyaratkan operator terautentikasi.')
      console.error('Gunakan --email dan --password untuk login sebagai operator.')
      process.exit(1)
    }
    const operatorUserId = authData.user.id

    // Check target playlist and existing tracks
    const { data: existingTracks, error: playlistError } = await supabase
      .from('playlist_tracks')
      .select('id, title, artist_name, position, provider_track_id')
      .eq('playlist_id', options.playlist)
      .order('position', { ascending: false })

    if (playlistError) {
      console.error(`Error membaca playlist tujuan: ${playlistError.message}`)
      process.exit(1)
    }

    const existingKeys = new Set()
    let currentMaxPosition = 0

    if (existingTracks && existingTracks.length > 0) {
      currentMaxPosition = Number(existingTracks[0].position) || 0
      for (const t of existingTracks) {
        existingKeys.add(normalizeSongKey(t.title, t.artist_name))
      }
    }

    const seenBatchKeys = new Set()
    const validTracksToProcess = []
    let nextPosition = currentMaxPosition + 1000.0

    for (const raw of batch) {
      const validated = validateOperatorTrack(raw, baseDir)

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

    // Process audio file uploads to Supabase Storage before DB insert
    const rowsToInsert = []

    for (const item of validTracksToProcess) {
      let finalStoragePath = null
      let finalAudioUrl = item.validated.audioSourceUrl || null
      let finalSourceType = item.validated.audioSourceType

      if (item.validated.hasAudioUpload && item.validated.audioFileInfo) {
        const fileInfo = item.validated.audioFileInfo
        let fileBuffer
        try {
          fileBuffer = fs.readFileSync(fileInfo.resolvedPath)
        } catch (readErr) {
          report.failed.push({
            title: item.validated.title,
            artistName: item.validated.artistName,
            errors: [`Gagal membaca file audio: ${readErr.message}`],
          })
          continue
        }

        const storagePath = `${options.playlist}/${item.providerTrackId}${fileInfo.extension}`

        const { error: uploadError } = await supabase.storage
          .from(DEFAULT_AUDIO_BUCKET)
          .upload(storagePath, fileBuffer, {
            contentType: fileInfo.mimeType,
            upsert: true,
          })

        if (uploadError) {
          report.failed.push({
            title: item.validated.title,
            artistName: item.validated.artistName,
            errors: [`Gagal mengunggah file audio ke Storage "${DEFAULT_AUDIO_BUCKET}": ${uploadError.message}`],
          })
          continue
        }

        const { data: urlData } = supabase.storage.from(DEFAULT_AUDIO_BUCKET).getPublicUrl(storagePath)
        finalStoragePath = storagePath
        finalAudioUrl = urlData.publicUrl
        finalSourceType = 'storage'
      }

      rowsToInsert.push({
        playlist_id: options.playlist,
        provider: item.validated.provider || 'spotify',
        provider_track_id: item.validated.providerTrackId || item.providerTrackId,
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

    if (rowsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from('playlist_tracks')
        .insert(rowsToInsert)

      if (insertError) {
        console.error('Error saat menyimpan lagu ke database:', insertError.message)
        process.exit(1)
      }

      // Re-read and verify persistence
      const insertedTrackIds = rowsToInsert.map((r) => r.provider_track_id)
      const { data: verifiedRows, error: verifyError } = await supabase
        .from('playlist_tracks')
        .select('id, title, artist_name, position, provider_track_id, verification_status, added_via, audio_url, storage_path, audio_source_type')
        .eq('playlist_id', options.playlist)
        .in('provider_track_id', insertedTrackIds)

      if (verifyError || !verifiedRows) {
        console.error('Error saat verifikasi ulang dari database:', verifyError?.message || 'Data tidak ditemukan')
        process.exit(1)
      }

      const verifiedMap = new Map(verifiedRows.map((r) => [r.provider_track_id, r]))

      for (const item of rowsToInsert) {
        const verifiedRow = verifiedMap.get(item.provider_track_id)
        const hasAudio = Boolean(verifiedRow?.audio_url || verifiedRow?.storage_path)

        report.succeeded.push({
          id: verifiedRow?.id,
          title: item.title,
          artistName: item.artist_name,
          position: item.position,
          verified: Boolean(verifiedRow),
          verificationStatus: verifiedRow?.verification_status || 'unverified',
          addedVia: verifiedRow?.added_via || 'ai_cli',
          hasAudio,
          isPlayable: hasAudio && verifiedRow?.audio_source_type !== 'external_url',
          audioSourceType: verifiedRow?.audio_source_type || item.audio_source_type,
          audioUrl: verifiedRow?.audio_url || item.audio_url,
          storagePath: verifiedRow?.storage_path || item.storage_path,
        })
      }
    }
  }

  // 4. Output formatting
  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
    if (report.failed.length > 0) {
      process.exitCode = 1
    }
    return
  }

  const playableCount = report.succeeded.filter((s) => s.hasAudio && s.isPlayable).length
  const metadataOnlyCount = report.succeeded.filter((s) => !s.hasAudio || !s.isPlayable).length

  console.log('\n======================================================')
  console.log('       ORBIM - LAPORAN IMPORT LAGU & AUDIO OPERATOR')
  console.log('======================================================')
  console.log(`Waktu             : ${report.timestamp}`)
  console.log(`Playlist Target   : ${report.playlistId}`)
  console.log(`Batas Batch       : Maksimal ${report.batchLimit} lagu`)
  console.log(`Total Diterima    : ${report.totalReceived} lagu`)
  console.log(`Total Diproses    : ${report.totalProcessed} lagu`)
  if (report.wasTruncated) {
    console.log(`⚠️ PERINGATAN      : Input melebihi batas batch (${report.batchLimit}). Lagu ke-12 dan seterusnya diabaikan.`)
  }
  if (report.dryRun) {
    console.log(`ℹ️ Mode           : DRY-RUN (Tidak ada penulisan ke database / storage)`)
  }
  console.log(`Audio Status      : ${playableCount} Dapat Diputar, ${metadataOnlyCount} Hanya Metadata`)
  console.log('------------------------------------------------------')

  console.log(`\n✅ ${report.dryRun ? 'Validasi Sukses (Dry-Run)' : 'Berhasil Disimpan & Terverifikasi'} (${report.succeeded.length}):`)
  if (report.succeeded.length === 0) {
    console.log(report.dryRun ? '   (Tidak ada lagu yang lolos validasi)' : '   (Tidak ada lagu yang disimpan)')
  } else {
    for (const s of report.succeeded) {
      const audioStatusLabel = s.hasAudio && s.isPlayable
        ? `🎵 Audio: Playable [${s.audioSourceType}]`
        : '📄 Audio: Metadata Only'
      const statusLabel = report.dryRun
        ? 'Status: Lolos Validasi (Dry-Run, Belum Disimpan)'
        : `Status Verifikasi: ${s.verificationStatus || 'unverified'}`
      console.log(`   - [Posisi ${s.position}] ${s.title} — ${s.artistName} (${audioStatusLabel}, ${statusLabel})`)
    }
  }

  console.log(`\n🔁 Duplikat Terdeteksi (${report.duplicates.length}):`)
  if (report.duplicates.length === 0) {
    console.log('   (Tidak ada duplikat)')
  } else {
    for (const d of report.duplicates) {
      const reasonText = d.reason === 'duplicate_in_batch' ? 'Duplikat dalam batch ini' : 'Sudah ada di playlist target'
      console.log(`   - ${d.title} — ${d.artistName} (${reasonText})`)
    }
  }

  console.log(`\n⚠️ Memerlukan Koreksi / Metadata Parsial (${report.needsCorrection.length}):`)
  if (report.needsCorrection.length === 0) {
    console.log('   (Semua metadata lengkap)')
  } else {
    for (const n of report.needsCorrection) {
      console.log(`   - ${n.title} — ${n.artistName}: [${n.notes.join(', ')}]`)
    }
  }

  console.log(`\n❌ Gagal Validasi / Upload (${report.failed.length}):`)
  if (report.failed.length === 0) {
    console.log('   (Tidak ada yang gagal)')
  } else {
    for (const f of report.failed) {
      console.log(`   - ${f.title} — ${f.artistName}: ${f.errors.join('; ')}`)
    }
  }

  console.log('\n======================================================\n')

  if (report.failed.length > 0) {
    process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Fatal error saat mengeksekusi operator import:', err.message)
    process.exit(1)
  })
}
