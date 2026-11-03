import type { MusicTrack } from '@/types/music'
import type { MusicProvider } from '@/services/music/types'

export const MAX_IMPORT_BATCH_SIZE = 11

export type ImportInputMode = 'artist_and_titles' | 'freeform_lines' | 'csv'

export interface ImportParsedRow {
  rawIndex: number
  title: string
  artistName: string
  albumName?: string
}

export interface ParseResult {
  rows: ImportParsedRow[]
  totalFound: number
  wasTruncated: boolean
  errors: string[]
}

export type ImportResolutionStatus = 'matched' | 'ambiguous' | 'custom' | 'resolving'

export interface ImportTrackItem {
  id: string
  originalInput: ImportParsedRow
  resolvedTrack: MusicTrack
  status: ImportResolutionStatus
  candidates: MusicTrack[]
  isDuplicateInBatch: boolean
  isDuplicateInTarget: boolean
  isPartialData: boolean
  isSelected: boolean
  userEdited: boolean
}

/**
 * Normalizes string for duplicate comparison (removes punctuation, excess spaces, lowercase).
 */
export function normalizeSongKey(title: string, artist: string): string {
  const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/gi, '').trim()
  const cleanArtist = artist.toLowerCase().replace(/[^a-z0-9]/gi, '').trim()
  return `${cleanArtist}:::${cleanTitle}`
}

/**
 * Parses raw text input when user specifies an Artist Name and a list of song titles (one per line).
 * Automatically cleans numbering like "1. ", "01 - ", bullet points, and quotes.
 */
export function parseArtistAndTitles(artist: string, text: string): ParseResult {
  const trimmedArtist = artist.trim()
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  const rows: ImportParsedRow[] = []
  const errors: string[] = []

  let index = 0
  for (const line of lines) {
    // Strip leading numbers e.g. "1.", "1 -", "[1]", "1)", bullet points "-", "*"
    const cleanTitle = line
      .replace(/^(\[\d+\]|\d+[.\-)\s]+|[-*•]\s*)/, '')
      .replace(/^["'“‘](.*)["'”’]$/, '$1')
      .trim()

    if (!cleanTitle) continue

    index += 1
    rows.push({
      rawIndex: index,
      title: cleanTitle,
      artistName: trimmedArtist || 'Unknown Artist',
    })
  }

  const totalFound = rows.length
  const wasTruncated = totalFound > MAX_IMPORT_BATCH_SIZE
  const limitedRows = wasTruncated ? rows.slice(0, MAX_IMPORT_BATCH_SIZE) : rows

  return {
    rows: limitedRows,
    totalFound,
    wasTruncated,
    errors,
  }
}

/**
 * Parses freeform lines containing both artist and title, such as:
 * - "Queen - Bohemian Rhapsody"
 * - "Bohemian Rhapsody by Queen"
 * - "Queen | Bohemian Rhapsody | A Night at the Opera"
 */
export function parseFreeformLines(text: string): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  const rows: ImportParsedRow[] = []
  let index = 0

  for (const line of lines) {
    const cleanLine = line
      .replace(/^(\[\d+\]|\d+[.\-)\s]+|[-*•]\s*)/, '')
      .trim()

    if (!cleanLine) continue

    index += 1

    let title = ''
    let artistName = ''
    let albumName: string | undefined

    if (cleanLine.includes(' | ')) {
      const parts = cleanLine.split(' | ').map((p) => p.trim())
      artistName = parts[0] || 'Unknown Artist'
      title = parts[1] || 'Untitled'
      albumName = parts[2] || undefined
    } else if (cleanLine.includes(' - ')) {
      const parts = cleanLine.split(' - ').map((p) => p.trim())
      if (parts.length >= 3) {
        artistName = parts[0]
        title = parts[1]
        albumName = parts[2]
      } else {
        artistName = parts[0]
        title = parts[1]
      }
    } else if (/\s+by\s+/i.test(cleanLine)) {
      const match = cleanLine.split(/\s+by\s+/i)
      title = match[0].trim()
      artistName = match[1].trim()
    } else {
      title = cleanLine
      artistName = 'Unknown Artist'
    }

    rows.push({
      rawIndex: index,
      title: title.replace(/^["'“‘](.*)["'”’]$/, '$1').trim(),
      artistName: artistName.replace(/^["'“‘](.*)["'”’]$/, '$1').trim(),
      albumName: albumName?.replace(/^["'“‘](.*)["'”’]$/, '$1').trim(),
    })
  }

  const totalFound = rows.length
  const wasTruncated = totalFound > MAX_IMPORT_BATCH_SIZE
  const limitedRows = wasTruncated ? rows.slice(0, MAX_IMPORT_BATCH_SIZE) : rows

  return {
    rows: limitedRows,
    totalFound,
    wasTruncated,
    errors: [],
  }
}

/**
 * Parses CSV or TSV content with standard header detection and RFC 4180 quote awareness.
 */
export function parseCsvContent(csvText: string): ParseResult {
  const errors: string[] = []
  if (!csvText || !csvText.trim()) {
    return { rows: [], totalFound: 0, wasTruncated: false, errors: ['File CSV kosong.'] }
  }

  // Parse lines considering quotes
  const lines: string[] = []
  let currentLine = ''
  let inQuotes = false

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i]
    if (char === '"') {
      inQuotes = !inQuotes
      currentLine += char
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && csvText[i + 1] === '\n') {
        i++
      }
      if (currentLine.trim()) {
        lines.push(currentLine.trim())
      }
      currentLine = ''
    } else {
      currentLine += char
    }
  }
  if (currentLine.trim()) {
    lines.push(currentLine.trim())
  }

  if (lines.length === 0) {
    return { rows: [], totalFound: 0, wasTruncated: false, errors: ['Tidak ada baris yang valid di file CSV.'] }
  }

  // Detect delimiter: check comma, semicolon, tab in first line
  const firstLine = lines[0]
  let delimiter = ','
  const commaCount = (firstLine.match(/,/g) || []).length
  const semicolonCount = (firstLine.match(/;/g) || []).length
  const tabCount = (firstLine.match(/\t/g) || []).length

  if (semicolonCount > commaCount && semicolonCount > tabCount) {
    delimiter = ';'
  } else if (tabCount > commaCount && tabCount > semicolonCount) {
    delimiter = '\t'
  }

  function splitRow(rowStr: string): string[] {
    const cols: string[] = []
    let cur = ''
    let inside = false
    for (let i = 0; i < rowStr.length; i++) {
      const c = rowStr[i]
      if (c === '"') {
        if (inside && rowStr[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inside = !inside
        }
      } else if (c === delimiter && !inside) {
        cols.push(cur.trim())
        cur = ''
      } else {
        cur += c
      }
    }
    cols.push(cur.trim())
    return cols
  }

  const rawHeader = splitRow(lines[0])
  const normalizedHeader = rawHeader.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''))

  let titleIdx = -1
  let artistIdx = -1
  let albumIdx = -1

  normalizedHeader.forEach((h, idx) => {
    if (['title', 'judul', 'track', 'trackname', 'song', 'songtitle', 'name'].includes(h)) {
      titleIdx = idx
    } else if (['artist', 'artistname', 'penyanyi', 'musisi', 'band', 'creator'].includes(h)) {
      artistIdx = idx
    } else if (['album', 'albumname', 'release'].includes(h)) {
      albumIdx = idx
    }
  })

  const hasHeader = titleIdx !== -1 || artistIdx !== -1
  const dataLines = hasHeader ? lines.slice(1) : lines

  if (!hasHeader) {
    // Default column assumptions: 0 = Title, 1 = Artist, 2 = Album (or 0 = Artist, 1 = Title)
    titleIdx = 0
    artistIdx = 1
    albumIdx = 2
  }

  const rows: ImportParsedRow[] = []
  let rowCount = 0

  for (const line of dataLines) {
    const cols = splitRow(line)
    if (cols.length === 0 || cols.every((c) => !c)) continue

    rowCount += 1
    const rawTitle = cols[titleIdx] ?? ''
    const rawArtist = artistIdx !== -1 ? (cols[artistIdx] ?? '') : ''
    const rawAlbum = albumIdx !== -1 ? (cols[albumIdx] ?? undefined) : undefined

    if (!rawTitle && !rawArtist) continue

    rows.push({
      rawIndex: rowCount,
      title: (rawTitle || 'Untitled').replace(/^["'“‘](.*)["'”’]$/, '$1').trim(),
      artistName: (rawArtist || 'Unknown Artist').replace(/^["'“‘](.*)["'”’]$/, '$1').trim(),
      albumName: rawAlbum ? rawAlbum.replace(/^["'“‘](.*)["'”’]$/, '$1').trim() : undefined,
    })
  }

  const totalFound = rows.length
  const wasTruncated = totalFound > MAX_IMPORT_BATCH_SIZE
  const limitedRows = wasTruncated ? rows.slice(0, MAX_IMPORT_BATCH_SIZE) : rows

  return {
    rows: limitedRows,
    totalFound,
    wasTruncated,
    errors,
  }
}

/**
 * Creates a clean default custom track when no catalog provider matches.
 */
export function createCustomTrack(parsed: ImportParsedRow): MusicTrack {
  const hash = Math.random().toString(36).substring(2, 9)
  return {
    provider: 'orbim',
    providerTrackId: `orb_${Date.now()}_${hash}`,
    title: parsed.title,
    artistName: parsed.artistName,
    albumName: parsed.albumName,
    durationSeconds: 0,
    genre: 'ORBIM Library',
    moods: [],
    isPlayable: false,
    audioSourceType: 'none',
    verificationStatus: 'unverified',
    attributionText: 'ORBIM Import',
    lyricsStatus: 'not_available',
    lyricsNotice: 'Lirik belum tersedia.',
  }
}

/**
 * Resolves parsed rows against the ORBIM database, detects duplicates in batch
 * and against existing target tracks, and flags ambiguous results.
 */
export async function resolveImportRows(
  rows: ImportParsedRow[],
  options: {
    provider?: MusicProvider
    targetExistingTracks?: MusicTrack[]
    onProgress?: (processed: number, total: number) => void
    onItemResolved?: (index: number, item: ImportTrackItem) => void
  } = {},
): Promise<ImportTrackItem[]> {
  const seenBatchKeys = new Set<string>()
  const targetKeys = new Set<string>()

  if (options.targetExistingTracks) {
    for (const t of options.targetExistingTracks) {
      targetKeys.add(normalizeSongKey(t.title, t.artistName))
    }
  }

  const resolvedItems: ImportTrackItem[] = []
  let processedCount = 0

  for (const row of rows) {
    const songKey = normalizeSongKey(row.title, row.artistName)
    const isDuplicateInBatch = seenBatchKeys.has(songKey)
    seenBatchKeys.add(songKey)

    const isDuplicateInTarget = targetKeys.has(songKey)

    let status: ImportResolutionStatus = 'custom'
    let resolvedTrack: MusicTrack = createCustomTrack(row)
    let candidates: MusicTrack[] = []

    if (options.provider && row.title.trim()) {
      try {
        const query = row.artistName !== 'Unknown Artist'
          ? `${row.artistName} ${row.title}`
          : row.title

        const searchResults = await options.provider.searchTracks(query, { limit: 5 })

        if (searchResults.length === 1) {
          status = 'matched'
          resolvedTrack = {
            ...searchResults[0],
            albumName: searchResults[0].albumName || row.albumName,
            lyricsStatus: 'not_available',
            lyricsNotice: 'Lirik belum tersedia dari penyedia ini.',
          }
        } else if (searchResults.length > 1) {
          // Check if first match is an exact title & artist match
          const first = searchResults[0]
          const isExact =
            first.title.toLowerCase() === row.title.toLowerCase() &&
            first.artistName.toLowerCase().includes(row.artistName.toLowerCase())

          if (isExact) {
            status = 'matched'
            resolvedTrack = {
              ...first,
              albumName: first.albumName || row.albumName,
              lyricsStatus: 'not_available',
              lyricsNotice: 'Lirik belum tersedia dari penyedia ini.',
            }
            candidates = searchResults
          } else {
            // Ambiguous results: offer candidates to user
            status = 'ambiguous'
            resolvedTrack = {
              ...first,
              albumName: first.albumName || row.albumName,
              lyricsStatus: 'not_available',
              lyricsNotice: 'Lirik belum tersedia dari penyedia ini.',
            }
            candidates = searchResults
          }
        }
      } catch {
        // Fall back to custom track if provider lookup fails
        status = 'custom'
      }
    }

    const isPartialData =
      !row.artistName ||
      row.artistName === 'Unknown Artist' ||
      !row.albumName ||
      resolvedTrack.durationSeconds === 0

    const item: ImportTrackItem = {
      id: `import_item_${row.rawIndex}_${Date.now()}`,
      originalInput: row,
      resolvedTrack,
      status,
      candidates,
      isDuplicateInBatch,
      isDuplicateInTarget,
      isPartialData,
      // Default to unselected if it's already in the target playlist or a duplicate in this batch
      isSelected: !isDuplicateInBatch && !isDuplicateInTarget,
      userEdited: false,
    }

    resolvedItems.push(item)

    if (options.onItemResolved) {
      options.onItemResolved(processedCount, item)
    }

    processedCount += 1
    if (options.onProgress) {
      options.onProgress(processedCount, rows.length)
    }
  }

  return resolvedItems
}
