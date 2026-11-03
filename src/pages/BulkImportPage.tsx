import {
  AlertTriangle,
  Check,
  CheckSquare,
  Copy,
  Edit2,
  FileSpreadsheet,
  FileText,
  Loader2,
  Music,
  RotateCcw,
  Sparkles,
  Upload,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { PageHeader } from '@/components/layout/PageHeader'
import { LyricsDialog } from '@/components/music/LyricsDialog'
import { TrackArtwork } from '@/components/music/TrackArtwork'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { TextField } from '@/components/ui/TextField'
import { mockPlaylists } from '@/data/mock'
import { useAuth } from '@/features/auth/auth-context'
import { useToast } from '@/features/feedback/toast-context'
import { pluralize } from '@/lib/format'
import { getDataSource } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  MAX_IMPORT_BATCH_SIZE,
  createCustomTrack,
  parseArtistAndTitles,
  parseCsvContent,
  parseFreeformLines,
  resolveImportRows,
  type ImportInputMode,
  type ImportParsedRow,
  type ImportTrackItem,
  type ParseResult,
} from '@/services/import/song-import'
import { getMusicProvider } from '@/services/music'
import { addMultipleTracksToPlaylist, fetchUserPlaylists } from '@/services/playlist/supabase-playlist'
import type { MusicTrack, Playlist } from '@/types/music'

const SAMPLE_ARTIST = 'Coldplay'
const SAMPLE_TITLES = `1. Yellow
2. Fix You
3. The Scientist
4. Viva La Vida
5. Clocks
6. Paradise
7. A Sky Full of Stars
8. In My Place
9. Speed of Sound
10. Sparks`

const SAMPLE_CSV = `title,artist,album
Yellow,Coldplay,Parachutes
Fix You,Coldplay,X&Y
The Scientist,Coldplay,A Rush of Blood to the Head
Bohemian Rhapsody,Queen,A Night at the Opera
Hotel California,Eagles,Hotel California`

export function BulkImportPage() {
  const [searchParams] = useSearchParams()
  const initialPlaylistId = searchParams.get('playlistId') || ''
  const navigate = useNavigate()
  const { user, isConfigured, isAdmin } = useAuth()
  const { notify } = useToast()
  const isDemo = getDataSource() === 'demo'

  // Target playlist selection
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>(initialPlaylistId)
  const [availablePlaylists, setAvailablePlaylists] = useState<Playlist[]>([])
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false)

  // Input states
  const [inputMode, setInputMode] = useState<ImportInputMode>('artist_and_titles')
  const [artistNameInput, setArtistNameInput] = useState('')
  const [rawTextInput, setRawTextInput] = useState('')
  const [csvFileName, setCsvFileName] = useState<string | null>(null)

  // Resolution & Review states
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [isResolving, setIsResolving] = useState(false)
  const [resolveProgress, setResolveProgress] = useState<{ current: number; total: number } | null>(null)
  const [importItems, setImportItems] = useState<ImportTrackItem[]>([])

  // Modal states
  const [lyricsModalTrack, setLyricsModalTrack] = useState<MusicTrack | null>(null)
  const [editingItem, setEditingItem] = useState<ImportTrackItem | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editArtist, setEditArtist] = useState('')
  const [editAlbum, setEditAlbum] = useState('')

  // Candidate selection modal for ambiguous matches
  const [candidateModalItem, setCandidateModalItem] = useState<ImportTrackItem | null>(null)

  // Import in progress
  const [isSaving, setIsSaving] = useState(false)

  // Load available playlists
  useEffect(() => {
    let isMounted = true

    async function loadPlaylists() {
      setIsLoadingPlaylists(true)

      // Demo playlists appear only in explicit demo mode; live mode lists Supabase rows only.
      let combined: Playlist[] = isDemo ? [...mockPlaylists] : []

      if (user && isConfigured) {
        const { data, error } = await fetchUserPlaylists()
        if (!error && data && isMounted) {
          const remoteMapped: Playlist[] = data.map((row) => ({
            id: row.id,
            title: row.title,
            description: row.description || undefined,
            owner: {
              id: row.owner_id,
              displayName: row.owner_id === user.id ? 'You' : 'Collaborator',
              location: '',
            },
            visibility: row.visibility,
            collaborators: [],
            trackEntries: [],
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }))
          // Merge avoiding ID duplicates
          const remoteIds = new Set(remoteMapped.map((p) => p.id))
          combined = [
            ...remoteMapped,
            ...(isDemo ? mockPlaylists.filter((p) => !remoteIds.has(p.id)) : []),
          ]
        }
      }

      if (isMounted) {
        setAvailablePlaylists(combined)
        setIsLoadingPlaylists(false)

        // If no selected playlist or initial parameter, default to first available
        if (!selectedPlaylistId && combined.length > 0) {
          setSelectedPlaylistId(combined[0].id)
        }
      }
    }

    loadPlaylists()

    return () => {
      isMounted = false
    }
  }, [user, isConfigured, isDemo, initialPlaylistId, selectedPlaylistId])

  const selectedPlaylist = useMemo(() => {
    return availablePlaylists.find((p) => p.id === selectedPlaylistId) || null
  }, [availablePlaylists, selectedPlaylistId])

  // Parse raw input into rows
  const handleParse = () => {
    let result: ParseResult

    if (inputMode === 'artist_and_titles') {
      if (!rawTextInput.trim()) {
        notify({ tone: 'info', title: 'Input kosong', description: 'Masukkan minimal satu judul lagu.' })
        return
      }
      result = parseArtistAndTitles(artistNameInput, rawTextInput)
    } else if (inputMode === 'freeform_lines') {
      if (!rawTextInput.trim()) {
        notify({ tone: 'info', title: 'Input kosong', description: 'Masukkan daftar lagu dalam format teks.' })
        return
      }
      result = parseFreeformLines(rawTextInput)
    } else {
      if (!rawTextInput.trim()) {
        notify({ tone: 'info', title: 'File/Data CSV kosong', description: 'Pilih file CSV atau tempel teks berformat CSV.' })
        return
      }
      result = parseCsvContent(rawTextInput)
    }

    if (result.rows.length === 0) {
      notify({ tone: 'info', title: 'Gagal memproses lagu', description: 'Tidak ada baris lagu yang valid untuk diproses.' })
      return
    }

    setParseResult(result)
    startResolution(result.rows)
  }

  // Handle CSV file upload
  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setCsvFileName(file.name)
    const reader = new FileReader()
    reader.onload = (event) => {
      const content = event.target?.result as string
      if (content) {
        setRawTextInput(content)
      }
    }
    reader.readAsText(file)
  }

  // Resolve metadata against ORBIM catalog & target playlist
  const startResolution = async (rows: ImportParsedRow[]) => {
    setIsResolving(true)
    setResolveProgress({ current: 0, total: rows.length })

    // Immediately display partial data safely so user sees results without blocking
    const initialItems: ImportTrackItem[] = rows.map((r, i) => ({
      id: `import_item_${r.rawIndex}_${i}_${Date.now()}`,
      originalInput: r,
      resolvedTrack: createCustomTrack(r),
      status: 'resolving',
      candidates: [],
      isDuplicateInBatch: false,
      isDuplicateInTarget: false,
      isPartialData: !r.artistName || r.artistName === 'Unknown Artist' || !r.albumName,
      isSelected: true,
      userEdited: false,
    }))
    setImportItems(initialItems)

    const provider = getMusicProvider(isDemo ? 'demo' : 'orbim')
    const targetTracks = selectedPlaylist?.trackEntries.map((te) => te.track) || []

    try {
      const items = await resolveImportRows(rows, {
        provider,
        targetExistingTracks: targetTracks,
        onProgress: (current, total) => {
          setResolveProgress({ current, total })
        },
        onItemResolved: (index, resolvedItem) => {
          setImportItems((prev) => {
            const next = [...prev]
            if (next[index]) {
              next[index] = resolvedItem
            }
            return next
          })
        },
      })
      setImportItems(items)
    } catch {
      notify({
        tone: 'info',
        title: 'Resolusi metadata gagal',
        description: 'Terjadi kendala saat memeriksa metadata. Lagu tetap dapat diimpor sebagai entri custom.',
      })
    } finally {
      setIsResolving(false)
      setResolveProgress(null)
    }
  }

  // Selection toggle
  const toggleSelectItem = (id: string) => {
    setImportItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, isSelected: !item.isSelected } : item)),
    )
  }

  const selectAll = (selected: boolean) => {
    setImportItems((prev) => prev.map((item) => ({ ...item, isSelected: selected })))
  }

  const excludeDuplicates = () => {
    setImportItems((prev) =>
      prev.map((item) => {
        if (item.isDuplicateInBatch || item.isDuplicateInTarget) {
          return { ...item, isSelected: false }
        }
        return item
      }),
    )
  }

  // Edit item inline/modal
  const handleOpenEdit = (item: ImportTrackItem) => {
    setEditingItem(item)
    setEditTitle(item.resolvedTrack.title)
    setEditArtist(item.resolvedTrack.artistName)
    setEditAlbum(item.resolvedTrack.albumName || '')
  }

  const handleSaveEdit = () => {
    if (!editingItem) return
    const updatedTitle = editTitle.trim() || editingItem.originalInput.title
    const updatedArtist = editArtist.trim() || editingItem.originalInput.artistName
    const updatedAlbum = editAlbum.trim() || undefined

    setImportItems((prev) =>
      prev.map((item) => {
        if (item.id === editingItem.id) {
          return {
            ...item,
            resolvedTrack: {
              ...item.resolvedTrack,
              title: updatedTitle,
              artistName: updatedArtist,
              albumName: updatedAlbum,
            },
            userEdited: true,
          }
        }
        return item
      }),
    )

    setEditingItem(null)
  }

  // Select alternative candidate for ambiguous matches
  const handleSelectCandidate = (candidate: MusicTrack) => {
    if (!candidateModalItem) return

    setImportItems((prev) =>
      prev.map((item) => {
        if (item.id === candidateModalItem.id) {
          return {
            ...item,
            resolvedTrack: {
              ...candidate,
              lyricsStatus: 'not_available',
              lyricsNotice: 'Lirik belum tersedia.',
            },
            status: 'matched',
            userEdited: true,
          }
        }
        return item
      }),
    )

    setCandidateModalItem(null)
  }

  // Reset workflow
  const handleReset = () => {
    setParseResult(null)
    setImportItems([])
    setRawTextInput('')
    setArtistNameInput('')
    setCsvFileName(null)
  }

  // Submit selected tracks to playlist
  const handleSaveToPlaylist = async () => {
    if (!selectedPlaylist) {
      notify({ tone: 'info', title: 'Playlist belum dipilih', description: 'Pilih playlist tujuan terlebih dahulu.' })
      return
    }

    if (!isAdmin) {
      notify({
        tone: 'info',
        title: 'Akses Ditolak',
        description: 'Hanya akun admin (dilfualtaf07@gmail.com) yang dapat mengimpor lagu ke playlist.',
      })
      return
    }

    const selectedTracks = importItems
      .filter((item) => item.isSelected)
      .map((item) => item.resolvedTrack)

    if (selectedTracks.length === 0) {
      notify({ tone: 'info', title: 'Belum ada lagu terpilih', description: 'Tandai minimal satu lagu untuk ditambahkan.' })
      return
    }

    if (!isAdmin) {
      notify({
        tone: 'info',
        title: 'Akses Terbatas',
        description: 'Hanya akun admin (dilfualtaf07@gmail.com) yang diizinkan mengimpor lagu.',
      })
      return
    }

    setIsSaving(true)

    try {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selectedPlaylist.id)

      if (isUUID && user) {
        // Cloud Supabase playlist
        const { count, error } = await addMultipleTracksToPlaylist({
          playlistId: selectedPlaylist.id,
          tracks: selectedTracks,
        })

        if (error) {
          throw error
        }

        notify({
          tone: 'info',
          title: 'Import lagu berhasil',
          description: `Berhasil menambahkan ${count} lagu ke playlist “${selectedPlaylist.title}”.`,
        })
      } else {
        // Mock demo playlist (in-memory update)
        const mockTarget = mockPlaylists.find((p) => p.id === selectedPlaylist.id)
        if (mockTarget) {
          for (const track of selectedTracks) {
            mockTarget.trackEntries.push({
              track,
              addedBy: {
                id: user?.id || 'viewer',
                displayName: user?.email ? user.email.split('@')[0] : 'You',
                location: 'Current session',
              },
              addedAt: new Date().toISOString(),
            })
          }
        }

        notify({
          tone: 'info',
          title: 'Lagu ditambahkan ke demo playlist',
          description: `Berhasil menambahkan ${selectedTracks.length} lagu ke “${selectedPlaylist.title}”.`,
        })
      }

      // Navigate to playlist page
      navigate(`/playlist/${selectedPlaylist.id}`)
    } catch (err: unknown) {
      notify({
        tone: 'info',
        title: 'Gagal menambahkan lagu',
        description: err instanceof Error ? err.message : 'Terjadi kendala saat menyimpan lagu ke playlist.',
      })
    } finally {
      setIsSaving(false)
    }
  }

  // Summary counts
  const totalItems = importItems.length
  const selectedCount = importItems.filter((i) => i.isSelected).length
  const matchedCount = importItems.filter((i) => i.status === 'matched').length
  const ambiguousCount = importItems.filter((i) => i.status === 'ambiguous').length
  const duplicateBatchCount = importItems.filter((i) => i.isDuplicateInBatch).length
  const duplicateTargetCount = importItems.filter((i) => i.isDuplicateInTarget).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bulk Song Import"
        description={`Kelola dan impor hingga ${MAX_IMPORT_BATCH_SIZE} lagu per batch ke playlist ORBIM. Masukkan nama penyanyi, daftar judul lagu, atau file CSV.`}
        actions={
          importItems.length > 0 ? (
            <Button variant="secondary" size="sm" onClick={handleReset}>
              <RotateCcw className="size-4" />
              Mulai Ulang
            </Button>
          ) : undefined
        }
      />

      {/* STEP 1: Input and Target Selection (Shown when not yet parsed/reviewed) */}
      {importItems.length === 0 ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-5 rounded-card border border-border bg-surface/50 p-4 sm:p-6">
            {/* Input Mode Selector Tabs */}
            <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
              <button
                type="button"
                onClick={() => setInputMode('artist_and_titles')}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors',
                  inputMode === 'artist_and_titles'
                    ? 'border border-border bg-elevated text-foreground shadow-xs'
                    : 'text-muted hover:bg-elevated/40 hover:text-foreground',
                )}
              >
                <Music className="size-3.5 text-accent" />
                Artis & Daftar Judul
              </button>
              <button
                type="button"
                onClick={() => setInputMode('freeform_lines')}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors',
                  inputMode === 'freeform_lines'
                    ? 'border border-border bg-elevated text-foreground shadow-xs'
                    : 'text-muted hover:bg-elevated/40 hover:text-foreground',
                )}
              >
                <FileText className="size-3.5 text-accent" />
                Baris Teks Bebas
              </button>
              <button
                type="button"
                onClick={() => setInputMode('csv')}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors',
                  inputMode === 'csv'
                    ? 'border border-border bg-elevated text-foreground shadow-xs'
                    : 'text-muted hover:bg-elevated/40 hover:text-foreground',
                )}
              >
                <FileSpreadsheet className="size-3.5 text-accent" />
                Upload CSV
              </button>
            </div>

            {/* Mode 1: Artist + Titles */}
            {inputMode === 'artist_and_titles' ? (
              <div className="space-y-4">
                <div>
                  <TextField
                    id="bulk-artist-input"
                    label="Nama Penyanyi / Artis"
                    placeholder="Contoh: Coldplay"
                    value={artistNameInput}
                    onChange={(e) => setArtistNameInput(e.target.value)}
                  />
                  <p className="mt-1 text-[11px] text-muted">
                    Semua judul lagu di bawah akan otomatis diasosiasikan dengan artis ini.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="bulk-titles-textarea" className="text-xs font-medium text-foreground">
                      Daftar Judul Lagu (Satu per baris, maks {MAX_IMPORT_BATCH_SIZE})
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setArtistNameInput(SAMPLE_ARTIST)
                        setRawTextInput(SAMPLE_TITLES)
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
                    >
                      <Copy className="size-3" />
                      Gunakan contoh data
                    </button>
                  </div>
                  <textarea
                    id="bulk-titles-textarea"
                    rows={10}
                    placeholder="1. Yellow&#10;2. Fix You&#10;3. The Scientist&#10;4. Viva La Vida&#10;5. Clocks"
                    value={rawTextInput}
                    onChange={(e) => setRawTextInput(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                  />
                  <p className="text-[11px] text-muted">
                    Penomoran otomatis (seperti <code>1. </code>, <code>- </code>) akan dibersihkan secara otomatis.
                  </p>
                </div>
              </div>
            ) : null}

            {/* Mode 2: Freeform Lines */}
            {inputMode === 'freeform_lines' ? (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="bulk-freeform-textarea" className="text-xs font-medium text-foreground">
                      Baris Teks Lagu (Format: Artis - Judul [ - Album ] atau Judul by Artis)
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setRawTextInput(
                          'Coldplay - Yellow - Parachutes\nColdplay - Fix You - X&Y\nQueen - Bohemian Rhapsody\nHotel California by Eagles',
                        )
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
                    >
                      <Copy className="size-3" />
                      Gunakan contoh format
                    </button>
                  </div>
                  <textarea
                    id="bulk-freeform-textarea"
                    rows={12}
                    placeholder="Queen - Bohemian Rhapsody&#10;Coldplay - Yellow - Parachutes&#10;Hotel California by Eagles"
                    value={rawTextInput}
                    onChange={(e) => setRawTextInput(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                  />
                </div>
              </div>
            ) : null}

            {/* Mode 3: CSV Import */}
            {inputMode === 'csv' ? (
              <div className="space-y-4">
                <div className="rounded-lg border-2 border-dashed border-border bg-surface/30 p-5 text-center transition-colors hover:border-accent/50">
                  <Upload className="mx-auto size-8 text-muted" />
                  <p className="mt-2 text-xs font-medium text-foreground">
                    Upload file CSV (.csv atau .txt)
                  </p>
                  <p className="mt-1 text-[11px] text-muted">
                    Mendukung pemisah koma (<code>,</code>) dan titik koma (<code>;</code>)
                  </p>
                  <input
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleFileUpload}
                    className="mt-3 block w-full text-xs text-muted file:mr-3 file:rounded-md file:border-0 file:bg-elevated file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground hover:file:bg-elevated/80"
                  />
                  {csvFileName ? (
                    <p className="mt-2 text-xs font-medium text-accent">File terpilih: {csvFileName}</p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="bulk-csv-textarea" className="text-xs font-medium text-foreground">
                      Atau Tempel Konten CSV
                    </label>
                    <button
                      type="button"
                      onClick={() => setRawTextInput(SAMPLE_CSV)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
                    >
                      <Copy className="size-3" />
                      Gunakan template CSV
                    </button>
                  </div>
                  <textarea
                    id="bulk-csv-textarea"
                    rows={8}
                    placeholder="title,artist,album&#10;Yellow,Coldplay,Parachutes&#10;Fix You,Coldplay,X&Y"
                    value={rawTextInput}
                    onChange={(e) => setRawTextInput(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                  />
                </div>
              </div>
            ) : null}

            {/* Process Button */}
            <div className="pt-2">
              <Button
                variant="primary"
                onClick={handleParse}
                disabled={isResolving || !rawTextInput.trim()}
                className="w-full sm:w-auto"
              >
                {isResolving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Memproses Resolusi Metadata…
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" />
                    Analisis & Cari Metadata (Maks {MAX_IMPORT_BATCH_SIZE} Lagu)
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Target Playlist Selector Card */}
          <aside className="space-y-4">
            <section className="rounded-card border border-border bg-surface/50 p-4">
              <div className="flex items-center gap-2">
                <Users className="size-4 text-accent" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Playlist Tujuan
                </h3>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted">
                Pilih playlist kolaboratif yang akan diisi dengan lagu-lagu hasil import.
              </p>

              <div className="mt-3 space-y-2">
                {isLoadingPlaylists ? (
                  <p className="text-xs text-muted">Memuat daftar playlist…</p>
                ) : availablePlaylists.length === 0 ? (
                  <p className="text-xs text-muted">Belum ada playlist yang tersedia.</p>
                ) : (
                  <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
                    {availablePlaylists.map((pl) => {
                      const isSelected = pl.id === selectedPlaylistId
                      return (
                        <button
                          key={pl.id}
                          type="button"
                          onClick={() => setSelectedPlaylistId(pl.id)}
                          className={cn(
                            'w-full text-left rounded-lg border p-2.5 transition-colors',
                            isSelected
                              ? 'border-accent/40 bg-accent/10 text-foreground'
                              : 'border-border/60 bg-surface/40 text-muted hover:border-border hover:text-foreground',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-medium">{pl.title}</span>
                            {isSelected ? <Check className="size-3.5 text-accent shrink-0" /> : null}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted">
                            <span>{pl.owner.displayName}</span>
                            <span>·</span>
                            <span>{pluralize(pl.trackEntries.length, 'track')}</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="mt-4 border-t border-border/70 pt-3 text-[11px] text-muted">
                <p>
                  Batasan batch: <strong>Maksimal {MAX_IMPORT_BATCH_SIZE} lagu per sesi</strong> untuk menjaga stabilitas memori dan performa jaringan.
                </p>
              </div>
            </section>
          </aside>
        </div>
      ) : null}

      {/* Progress Indicator */}
      {isResolving && resolveProgress ? (
        <div className="rounded-card border border-accent/30 bg-accent/5 p-4 text-center space-y-2">
          <div className="flex items-center justify-center gap-2 text-xs font-medium text-accent">
            <Loader2 className="size-4 animate-spin" />
            <span>Memeriksa metadata di database ORBIM ({resolveProgress.current} / {resolveProgress.total})</span>
          </div>
          <div className="mx-auto h-1.5 w-64 max-w-full overflow-hidden rounded-full bg-border">
            <div
              className="h-full bg-accent transition-[width] duration-200"
              style={{ width: `${(resolveProgress.current / resolveProgress.total) * 100}%` }}
            />
          </div>
        </div>
      ) : null}

      {/* STEP 2: Review and Edit Screen (When items are resolved) */}
      {importItems.length > 0 ? (
        <div className="space-y-4">
          {/* Truncation warning if user pasted > MAX_IMPORT_BATCH_SIZE songs */}
          {parseResult?.wasTruncated ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              <AlertTriangle className="size-4 shrink-0 text-amber-400 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-300">
                  Ditemukan {parseResult.totalFound} lagu — dibatasi ke {MAX_IMPORT_BATCH_SIZE} lagu
                </p>
                <p className="text-[11px] opacity-90">
                  Sesuai batasan sistem ORBIM, batch impor diproses maksimal {MAX_IMPORT_BATCH_SIZE} lagu sekaligus.
                </p>
              </div>
            </div>
          ) : null}

          {/* Action and Summary Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface/60 p-3.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge tone="accent">Total: {totalItems}</Badge>
              <Badge tone="neutral">Terpilih: {selectedCount}</Badge>
              {matchedCount > 0 ? (
                <Badge tone="neutral" className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
                  Database: {matchedCount}
                </Badge>
              ) : null}
              {ambiguousCount > 0 ? (
                <Badge tone="neutral" className="bg-amber-500/15 text-amber-300 border-amber-500/30">
                  Ambigu: {ambiguousCount}
                </Badge>
              ) : null}
              {duplicateBatchCount + duplicateTargetCount > 0 ? (
                <Badge tone="neutral" className="bg-rose-500/15 text-rose-300 border-rose-500/30">
                  Duplikat: {duplicateBatchCount + duplicateTargetCount}
                </Badge>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => selectAll(true)}
                className="text-xs"
              >
                Pilih Semua
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => selectAll(false)}
                className="text-xs"
              >
                Batalkan Semua
              </Button>
              {duplicateBatchCount + duplicateTargetCount > 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={excludeDuplicates}
                  className="text-xs text-amber-300 hover:text-amber-200"
                >
                  Kecualikan Duplikat
                </Button>
              ) : null}
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveToPlaylist}
                disabled={isSaving || selectedCount === 0 || !selectedPlaylist}
                className="text-xs"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Menyimpan…
                  </>
                ) : (
                  <>
                    <CheckSquare className="size-3.5" />
                    Tambahkan {selectedCount} Lagu ke {selectedPlaylist?.title || 'Playlist'}
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Interactive Song List */}
          <div className="overflow-hidden rounded-card border border-border bg-surface/40">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-surface/80 text-[11px] font-semibold text-muted uppercase tracking-wider">
                  <tr>
                    <th scope="col" className="w-10 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedCount === totalItems && totalItems > 0}
                        onChange={(e) => selectAll(e.target.checked)}
                        aria-label="Pilih semua lagu"
                        className="size-3.5 rounded border-border text-accent focus:ring-accent"
                      />
                    </th>
                    <th scope="col" className="w-12 px-2 py-2.5">Cover</th>
                    <th scope="col" className="px-3 py-2.5">Judul Lagu</th>
                    <th scope="col" className="px-3 py-2.5">Artis / Penyanyi</th>
                    <th scope="col" className="hidden sm:table-cell px-3 py-2.5">Album</th>
                    <th scope="col" className="px-3 py-2.5">Sumber & Status</th>
                    <th scope="col" className="w-24 px-3 py-2.5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {importItems.map((item) => {
                    const track = item.resolvedTrack
                    const isMatched = item.status === 'matched'
                    const isAmbiguous = item.status === 'ambiguous'

                    return (
                      <tr
                        key={item.id}
                        className={cn(
                          'transition-colors hover:bg-elevated/40',
                          item.isSelected ? 'bg-accent/[0.03]' : 'opacity-70',
                          (item.isDuplicateInBatch || item.isDuplicateInTarget) && 'bg-rose-950/10',
                        )}
                      >
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={item.isSelected}
                            onChange={() => toggleSelectItem(item.id)}
                            aria-label={`Pilih ${track.title}`}
                            className="size-3.5 rounded border-border text-accent focus:ring-accent"
                          />
                        </td>
                        <td className="px-2 py-2.5">
                          <TrackArtwork track={track} className="size-8 rounded-md shrink-0" />
                        </td>
                        <td className="px-3 py-2.5 font-medium text-foreground">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate max-w-[12rem] sm:max-w-xs">{track.title}</span>
                            {item.userEdited ? (
                              <span title="Diedit oleh pengguna" className="text-[10px] text-accent">✎</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-muted">
                          <span className="truncate max-w-[10rem] block">{track.artistName}</span>
                        </td>
                        <td className="hidden sm:table-cell px-3 py-2.5 text-muted">
                          <span className="truncate max-w-[8rem] block">{track.albumName || '—'}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-1">
                            {item.status === 'resolving' ? (
                              <Badge tone="accent" className="text-[10px] py-0 animate-pulse">
                                Memeriksa…
                              </Badge>
                            ) : isMatched ? (
                              <Badge tone="neutral" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 text-[10px] py-0">
                                ORBIM DB
                              </Badge>
                            ) : (
                              <Badge tone="neutral" className="text-[10px] py-0">
                                Manual / Custom
                              </Badge>
                            )}

                            {item.isPartialData ? (
                              <span title="Data parsial: beberapa atribut opsional belum terisi, aman ditampilkan & disimpan">
                                <Badge tone="neutral" className="text-[10px] py-0 border-dashed text-muted">
                                  Data Parsial
                                </Badge>
                              </span>
                            ) : null}

                            {isAmbiguous ? (
                              <button
                                type="button"
                                onClick={() => setCandidateModalItem(item)}
                                className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 hover:bg-amber-500/20"
                                title="Klik untuk memilih dari beberapa kandidat lagu yang cocok"
                              >
                                Ambigu ({item.candidates.length})
                              </button>
                            ) : null}

                            {item.isDuplicateInTarget ? (
                              <Badge tone="neutral" className="bg-rose-500/10 text-rose-300 border-rose-500/30 text-[10px] py-0">
                                Ada di Playlist
                              </Badge>
                            ) : null}

                            {item.isDuplicateInBatch ? (
                              <Badge tone="neutral" className="bg-amber-500/10 text-amber-300 border-amber-500/30 text-[10px] py-0">
                                Duplikat Batch
                              </Badge>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => setLyricsModalTrack(track)}
                              className="rounded p-1 text-muted transition-colors hover:text-accent hover:bg-elevated/70"
                              title="Periksa status lirik"
                            >
                              <FileText className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(item)}
                              className="rounded p-1 text-muted transition-colors hover:text-foreground hover:bg-elevated/70"
                              title="Edit metadata lagu"
                            >
                              <Edit2 className="size-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {/* Edit Metadata Modal */}
      <Dialog
        open={editingItem !== null}
        onClose={() => setEditingItem(null)}
        title="Edit Metadata Lagu"
        description="Perbarui informasi lagu sebelum ditambahkan ke playlist."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditingItem(null)}>
              Batal
            </Button>
            <Button variant="primary" onClick={handleSaveEdit}>
              Simpan Perubahan
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <TextField
            id="edit-modal-title"
            label="Judul Lagu"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
          />
          <TextField
            id="edit-modal-artist"
            label="Nama Penyanyi / Artis"
            value={editArtist}
            onChange={(e) => setEditArtist(e.target.value)}
          />
          <TextField
            id="edit-modal-album"
            label="Album (Opsional)"
            value={editAlbum}
            onChange={(e) => setEditAlbum(e.target.value)}
          />
        </div>
      </Dialog>

      {/* Ambiguous Candidates Modal */}
      <Dialog
        open={candidateModalItem !== null}
        onClose={() => setCandidateModalItem(null)}
        title="Pilih Kandidat Metadata yang Sesuai"
        description={`Ditemukan beberapa lagu yang mirip dengan “${candidateModalItem?.originalInput.title}” oleh ${candidateModalItem?.originalInput.artistName}. Pilih hasil yang paling tepat:`}
        footer={
          <Button variant="secondary" onClick={() => setCandidateModalItem(null)}>
            Tutup
          </Button>
        }
      >
        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {candidateModalItem?.candidates.map((candidate) => (
            <button
              key={candidate.providerTrackId}
              type="button"
              onClick={() => handleSelectCandidate(candidate)}
              className="w-full flex items-center justify-between gap-3 rounded-lg border border-border bg-surface/50 p-2.5 text-left transition-colors hover:border-accent hover:bg-accent/5"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <TrackArtwork track={candidate} className="size-10 rounded shrink-0" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-foreground">{candidate.title}</p>
                  <p className="truncate text-[11px] text-muted">{candidate.artistName}</p>
                  <p className="truncate text-[10px] text-muted">{candidate.albumName || 'Album tidak tertera'}</p>
                </div>
              </div>
              <span className="text-[11px] font-medium text-accent shrink-0">Pilih ini</span>
            </button>
          ))}
        </div>
      </Dialog>

      {/* Lyrics Legal & Status Modal */}
      <LyricsDialog
        track={lyricsModalTrack}
        open={lyricsModalTrack !== null}
        onClose={() => setLyricsModalTrack(null)}
      />
    </div>
  )
}
