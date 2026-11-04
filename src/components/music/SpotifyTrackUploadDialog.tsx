import {
  AlertCircle,
  Check,
  ExternalLink,
  FileAudio,
  Globe,
  Loader2,
  Music,
  RotateCcw,
  Search,
  Sparkles,
  Upload,
  Volume2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState, useTransition } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Skeleton } from '@/components/ui/Skeleton'
import { useAuth } from '@/features/auth/auth-context'
import { useToast } from '@/features/feedback/toast-context'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  mapCatalogRecordToMusicTrack,
  uploadAndPublishCatalogTrack,
  validateCatalogAudioFile,
} from '@/services/catalog/global-catalog-service'
import { searchSpotifyMetadata } from '@/services/spotify'
import type { MusicTrack } from '@/types/music'

const QUICK_SUGGESTIONS = [
  'Coldplay - Yellow',
  'The Weeknd - Blinding Lights',
  'Queen - Bohemian Rhapsody',
  'Taylor Swift - Anti-Hero',
  'Rick Astley - Never Gonna Give You Up',
]

export interface SpotifyTrackUploadDialogProps {
  open: boolean
  onClose: () => void
  initialPlaylistId?: string
  preselectedTrack?: MusicTrack | null
  onSuccess?: (playlistIdOrTrack: string | MusicTrack, track?: MusicTrack) => void
}

export function SpotifyTrackUploadDialog({
  open,
  onClose,
  preselectedTrack,
  onSuccess,
}: SpotifyTrackUploadDialogProps) {
  const { user, isAdmin } = useAuth()
  const { notify } = useToast()

  // Step state: 1 = Search Spotify, 2 = Attach Audio & Save
  const [step, setStep] = useState<'search' | 'upload'>(preselectedTrack ? 'upload' : 'search')

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, startSearchTransition] = useTransition()
  const [searchResults, setSearchResults] = useState<MusicTrack[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)

  // Selected track state
  const [selectedTrack, setSelectedTrack] = useState<MusicTrack | null>(preselectedTrack || null)

  // Audio file upload state
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [hasPermission, setHasPermission] = useState<boolean>(true)

  // Generate preview audio URL when file is picked
  const audioPreviewUrl = useMemo(() => {
    if (!audioFile || typeof window === 'undefined') return null
    try {
      return URL.createObjectURL(audioFile)
    } catch {
      return null
    }
  }, [audioFile])

  useEffect(() => {
    return () => {
      if (audioPreviewUrl) {
        URL.revokeObjectURL(audioPreviewUrl)
      }
    }
  }, [audioPreviewUrl])

  // Uploading state
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [submitStepText, setSubmitStepText] = useState<string>('')
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Sync preselected track when props change
  const [prevPreselectedTrack, setPrevPreselectedTrack] = useState(preselectedTrack)
  if (preselectedTrack !== prevPreselectedTrack) {
    setPrevPreselectedTrack(preselectedTrack)
    if (preselectedTrack) {
      setSelectedTrack(preselectedTrack)
      setStep('upload')
    }
  }

  // Perform search
  function handleSearch(queryText: string) {
    const q = queryText.trim()
    if (!q) {
      setSearchResults([])
      setSearchError(null)
      return
    }

    startSearchTransition(async () => {
      setSearchError(null)
      try {
        const results = await searchSpotifyMetadata(q, { limit: 8 })
        setSearchResults(results)
        if (results.length === 0) {
          setSearchError(`No tracks found matching "${q}". Try another keyword.`)
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to search Spotify catalog.'
        setSearchError(msg)
        setSearchResults([])
      }
    })
  }

  // Handle file selection
  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setFileError(null)

    if (!file) {
      setAudioFile(null)
      return
    }

    const validation = validateCatalogAudioFile(file)
    if (!validation.valid) {
      setFileError(validation.error || 'Invalid audio file format or size.')
      setAudioFile(null)
      return
    }

    setAudioFile(file)
  }

  // Handle final upload and save
  async function handleSubmit() {
    setSubmitError(null)

    if (!isAdmin) {
      setSubmitError('Hanya akun administrator (dilfualtaf07@gmail.com) yang diizinkan mengunggah file audio.')
      return
    }

    if (!selectedTrack) {
      setSubmitError('Pilih lagu dari pencarian terlebih dahulu.')
      return
    }

    if (!audioFile) {
      setSubmitError('Pilih file audio (.mp3, .wav, dsb.) yang ingin diunggah.')
      return
    }

    setIsSubmitting(true)
    setSubmitStepText('Mengunggah audio dan mempublikasikan lagu...')

    try {
      const result = await uploadAndPublishCatalogTrack({
        userEmail: user?.email,
        userId: user?.id,
        track: selectedTrack,
        audioFile,
      })

      if (!result.success || !result.catalogTrack) {
        throw result.error || new Error('Gagal mengunggah file audio.')
      }

      const publishedTrack = mapCatalogRecordToMusicTrack(result.catalogTrack)

      setSubmitStepText('Selesai!')
      notify({
        title: 'Audio Berhasil Dipublikasikan!',
        description: `"${selectedTrack.title}" sekarang siap dan dapat diputar di ORBIM.`,
        tone: 'success',
      })

      if (onSuccess) {
        onSuccess(publishedTrack, publishedTrack)
      }

      handleReset()
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setSubmitError(msg)
    } finally {
      setIsSubmitting(false)
      setSubmitStepText('')
    }
  }

  function handleReset() {
    setStep(preselectedTrack ? 'upload' : 'search')
    if (!preselectedTrack) {
      setSelectedTrack(null)
    }
    setAudioFile(null)
    setFileError(null)
    setSearchQuery('')
    setSearchResults([])
    setSearchError(null)
    setSubmitError(null)
  }

  function handleDialogClose() {
    if (!isSubmitting) {
      handleReset()
      onClose()
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleDialogClose}
      title="Add Track & Audio"
      description="Select a track from Spotify's global catalog and attach audio for seamless playback across ORBIM."
      className="w-[min(94vw,44rem)] max-w-2xl"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          {step === 'upload' && !preselectedTrack ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setStep('search')}
              disabled={isSubmitting}
              className="gap-1.5"
            >
              <RotateCcw className="size-3.5" />
              <span>Back to Search</span>
            </Button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={handleDialogClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>

            {step === 'upload' ? (
              <Button
                type="button"
                variant="primary"
                onClick={handleSubmit}
                disabled={isSubmitting || !isAdmin}
                title={!isAdmin ? 'Only admin can publish audio' : undefined}
                className="gap-2 bg-accent text-accent-contrast hover:bg-accent-hover shadow-md shadow-accent/20"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                    <span>{submitStepText || 'Publishing...'}</span>
                  </>
                ) : (
                  <>
                    <Upload aria-hidden="true" className="size-4" />
                    <span>Publish Audio to All Users</span>
                  </>
                )}
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      <div className="space-y-4 py-1">
        {/* Step Indicator Header */}
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isSubmitting || Boolean(preselectedTrack)}
              onClick={() => setStep('search')}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                step === 'search'
                  ? 'bg-accent/20 text-accent font-semibold ring-1 ring-accent/30'
                  : selectedTrack
                    ? 'bg-surface text-foreground hover:bg-surface-elevated'
                    : 'text-muted opacity-70',
              )}
            >
              <span className="flex size-4 items-center justify-center rounded-full bg-accent/20 text-[10px]">
                {selectedTrack && step === 'upload' ? '✓' : '1'}
              </span>
              <span>1. Choose Track</span>
            </button>

            <span className="text-muted/40">›</span>

            <div
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                step === 'upload'
                  ? 'bg-accent/20 text-accent font-semibold ring-1 ring-accent/30'
                  : 'text-muted opacity-70',
              )}
            >
              <span className="flex size-4 items-center justify-center rounded-full bg-accent/20 text-[10px]">
                2
              </span>
              <span>2. Attach Audio & Publish</span>
            </div>
          </div>

          <Badge tone="accent" className="hidden sm:inline-flex text-[10px] uppercase tracking-wider">
            Admin Controlled
          </Badge>
        </div>

        {/* Admin Permission Warning */}
        {!isAdmin ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            <AlertCircle aria-hidden="true" className="size-4 shrink-0 text-amber-400 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-semibold text-amber-300">Admin Permissions Required: </span>
              Only platform administrator accounts (<strong className="font-mono text-white">dilfualtaf07@gmail.com</strong>) are permitted to add tracks or upload audio.
            </div>
          </div>
        ) : null}

        {/* Submit Error Alert */}
        {submitError ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
            <AlertCircle aria-hidden="true" className="size-4 shrink-0 text-rose-400 mt-0.5" />
            <div className="flex-1 leading-relaxed">
              <strong className="block font-semibold">Upload failed:</strong>
              <span>{submitError}</span>
            </div>
          </div>
        ) : null}

        {/* STEP 1: SPOTIFY SEARCH */}
        {step === 'search' ? (
          <div className="space-y-4">
            <div className="relative">
              <label htmlFor="spotify-search-input" className="sr-only">
                Search tracks
              </label>
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                <Search aria-hidden="true" className="size-4 text-muted" />
              </div>
              <input
                id="spotify-search-input"
                type="search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  handleSearch(e.target.value)
                }}
                placeholder="Search by song title, artist, or album..."
                className="w-full rounded-lg border border-border bg-surface/90 py-2.5 pr-9 pl-10 text-sm text-foreground placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-all shadow-inner"
                autoFocus
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('')
                    setSearchResults([])
                    setSearchError(null)
                  }}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>

            {/* Quick Suggestions */}
            {!searchQuery && searchResults.length === 0 ? (
              <div className="space-y-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
                  <Sparkles className="size-3 text-accent" />
                  Quick Suggestions
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_SUGGESTIONS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setSearchQuery(item)
                        handleSearch(item)
                      }}
                      className="rounded-full border border-border/80 bg-surface/60 px-3 py-1 text-xs text-muted hover:border-accent hover:text-foreground hover:bg-surface transition-colors"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {isSearching ? (
              <div className="space-y-2 py-2">
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-16 w-full rounded-lg" />
              </div>
            ) : null}

            {searchError ? (
              <div className="rounded-lg border border-border/80 bg-surface/50 p-4 text-center text-xs text-muted">
                {searchError}
              </div>
            ) : null}

            {!isSearching && searchResults.length > 0 ? (
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                <span className="text-[11px] font-medium tracking-wider text-muted uppercase">
                  Search Results ({searchResults.length})
                </span>
                {searchResults.map((t) => (
                  <div
                    key={t.providerTrackId}
                    onClick={() => {
                      setSelectedTrack(t)
                      setStep('upload')
                    }}
                    className="group flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border/60 bg-surface/50 p-3 transition-all hover:border-accent/70 hover:bg-surface hover:shadow-sm"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {t.artworkUrl ? (
                        <img
                          src={t.artworkUrl}
                          alt={t.title}
                          className="size-12 shrink-0 rounded-md object-cover shadow-sm group-hover:scale-105 transition-transform"
                        />
                      ) : (
                        <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-surface-muted text-muted">
                          <Music className="size-5" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground group-hover:text-accent transition-colors">
                          {t.title}
                        </div>
                        <div className="truncate text-xs text-muted">
                          {t.artistName} {t.albumName ? `· ${t.albumName}` : ''}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2.5">
                      <span className="text-xs text-muted font-mono">
                        {formatDuration(t.durationSeconds)}
                      </span>
                      {t.externalUrl ? (
                        <a
                          href={t.externalUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          onClick={(e) => e.stopPropagation()}
                          title="Open on Spotify"
                          className="rounded p-1 text-muted hover:text-foreground"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      ) : null}
                      <Button size="sm" variant="secondary" className="text-xs group-hover:border-accent/40">
                        Select
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* STEP 2: UPLOAD AUDIO & PUBLISH */}
        {step === 'upload' && selectedTrack ? (
          <div className="space-y-4">
            {/* Selected Track Showcase Card */}
            <div className="flex items-center justify-between gap-3 rounded-xl border border-accent/30 bg-gradient-to-r from-accent/10 via-surface to-surface p-3.5 sm:p-4 shadow-sm">
              <div className="flex min-w-0 items-center gap-3.5">
                {selectedTrack.artworkUrl ? (
                  <img
                    src={selectedTrack.artworkUrl}
                    alt={selectedTrack.title}
                    className="size-16 shrink-0 rounded-lg object-cover shadow-md ring-1 ring-black/10"
                  />
                ) : (
                  <div className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-surface text-muted border border-border">
                    <Music className="size-7" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-base font-bold text-foreground">
                      {selectedTrack.title}
                    </span>
                    <Badge tone="accent" className="shrink-0 text-[10px]">
                      Spotify Metadata
                    </Badge>
                  </div>
                  <div className="truncate text-xs font-medium text-foreground/80 mt-0.5">
                    {selectedTrack.artistName} {selectedTrack.albumName ? `— ${selectedTrack.albumName}` : ''}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                    <span className="font-mono">{formatDuration(selectedTrack.durationSeconds)}</span>
                    {selectedTrack.externalUrl ? (
                      <>
                        <span>·</span>
                        <a
                          href={selectedTrack.externalUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 text-accent hover:underline"
                        >
                          Spotify
                          <ExternalLink className="size-2.5" />
                        </a>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>

              {!preselectedTrack ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setStep('search')}
                  disabled={isSubmitting}
                  className="gap-1 text-xs text-muted hover:text-foreground shrink-0"
                >
                  <RotateCcw className="size-3" />
                  <span>Change</span>
                </Button>
              ) : null}
            </div>

            {/* Target Destination: Global Catalog */}
            <div className="rounded-xl border border-accent/30 bg-accent/5 p-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex size-6 items-center justify-center rounded-full bg-accent/20 text-accent">
                    <Globe className="size-3.5" />
                  </div>
                  <span className="text-xs font-semibold text-foreground">
                    Tujuan: Katalog Musik ORBIM
                  </span>
                </div>
                <Badge tone="accent" className="text-[10px] font-semibold">
                  Platform-wide
                </Badge>
              </div>
              <p className="mt-1.5 pl-8 text-[11px] leading-relaxed text-muted">
                Audio yang diunggah akan dipublikasikan ke katalog global sehingga dapat langsung diputar di seluruh ORBIM.
              </p>
            </div>

            {/* Audio File Upload Dropzone */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground flex items-center justify-between">
                <span>Attach Audio File</span>
                <span className="text-[11px] font-normal text-muted">
                  MP3, WAV, FLAC, OGG, M4A, AAC · Max 50 MB
                </span>
              </label>

              <div
                className={cn(
                  'relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center transition-all',
                  audioFile
                    ? 'border-accent/60 bg-accent/[0.04]'
                    : 'border-border/80 bg-surface/30 hover:border-accent/50 hover:bg-surface/60',
                )}
              >
                <input
                  type="file"
                  accept=".mp3,.wav,.ogg,.opus,.m4a,.aac,.flac,audio/*"
                  onChange={handleFileChange}
                  disabled={isSubmitting}
                  className="absolute inset-0 cursor-pointer opacity-0"
                />

                {audioFile ? (
                  <div className="w-full space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent/20 text-accent">
                          <FileAudio className="size-5" />
                        </div>
                        <div className="text-left min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">
                            {audioFile.name}
                          </div>
                          <div className="text-xs text-muted">
                            {(audioFile.size / (1024 * 1024)).toFixed(2)} MB · Valid audio file
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-xs font-medium text-emerald-400">
                          <Check className="size-3" /> Ready
                        </span>
                        <Button size="sm" variant="ghost" className="text-xs text-muted hover:text-foreground">
                          Replace
                        </Button>
                      </div>
                    </div>

                    {/* In-line Audio Preview Player */}
                    {audioPreviewUrl && (
                      <div className="mt-2 pt-2 border-t border-border/50 text-left">
                        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted mb-1.5">
                          <Volume2 className="size-3.5 text-accent" />
                          <span>Preview playback before publishing:</span>
                        </div>
                        <audio
                          controls
                          src={audioPreviewUrl}
                          className="w-full h-8 rounded-lg"
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-2 flex flex-col items-center">
                    <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-accent/10 text-accent">
                      <Upload className="size-6" strokeWidth={1.75} />
                    </div>
                    <p className="text-xs font-semibold text-foreground">
                      Click to browse or drag & drop audio file here
                    </p>
                    <p className="mt-1 text-[11px] text-muted">
                      Full track audio will be published to the catalog for streaming
                    </p>
                  </div>
                )}
              </div>

              {fileError ? (
                <div className="flex items-center gap-1.5 text-xs text-rose-400">
                  <AlertCircle className="size-3.5 shrink-0" />
                  <span>{fileError}</span>
                </div>
              ) : null}
            </div>

            {/* Permission and Ownership Attestation */}
            <div className="rounded-xl border border-border/70 bg-surface/40 p-3">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hasPermission}
                  onChange={(e) => setHasPermission(e.target.checked)}
                  disabled={isSubmitting}
                  className="mt-0.5 size-4 rounded border-border text-accent focus:ring-accent"
                />
                <span className="text-xs leading-relaxed text-muted">
                  <strong className="text-foreground">Rights Attestation:</strong> I confirm that I own or hold valid authorization to stream this audio on ORBIM. Spotify strictly supplies track metadata; no audio is ripped from Spotify.
                </span>
              </label>
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
