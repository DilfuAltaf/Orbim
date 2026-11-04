import { AlertCircle, Play, Plus, RotateCcw, Search, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { PageHeader } from '@/components/layout/PageHeader'
import { SpotifyTrackUploadDialog } from '@/components/music/SpotifyTrackUploadDialog'
import { SearchBar } from '@/components/music/SearchBar'
import { TrackCard } from '@/components/music/TrackCard'
import { AddToPlaylistDialog } from '@/components/playlist/AddToPlaylistDialog'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useAuth } from '@/features/auth/auth-context'
import { usePlayer } from '@/features/player/player-context'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { getDataSource, isSupabaseConfigured, supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { getMusicProvider } from '@/services/music'
import { resolveExploreSearchState } from '@/services/music/explore-state'
import {
  enrichTracksWithGlobalAudio,
  getCachedAudioRecord,
  normalizeTrackId,
  resolveEffectiveTrack,
  syncGlobalAudioFromRemote,
} from '@/services/audio/global-audio-registry'
import {
  fetchPublishedCatalogTracks,
} from '@/services/catalog/global-catalog-service'
import type { MusicTrack } from '@/types/music'

const ALL_GENRES = null
const DEMO_GENRES = [
  'Electronic',
  'Rock',
  'Pop',
  'Indie',
  'Folk',
  'Jazz',
  'Ambient',
  'Lo-Fi',
]

type SearchResultState = {
  results: MusicTrack[]
  isLoading: boolean
  error: string | null
  /** Query/genre that produced `results`, so stale responses are never displayed. */
  forQuery: string
  forGenre: string | null
}

/**
 * Explore is ORBIM's global music discovery surface, powered by the Spotify Web API.
 *
 * Spotify only supplies metadata (and occasionally a 30-second preview). Nothing is
 * persisted until the user adds a track to one of their ORBIM playlists, which stays a
 * Supabase operation gated by playlist membership. The ORBIM database is never treated
 * as a global catalog: saved tracks live in Library and playlist pages.
 */
export function ExplorePage() {
  const { isAdmin } = useAuth()
  const isDemoMode = getDataSource() === 'demo'
  const provider = useMemo(
    () => getMusicProvider(isDemoMode ? 'demo' : 'spotify'),
    [isDemoMode],
  )

  const [adminTab, setAdminTab] = useState<'published' | 'spotify'>('published')

  const [query, setQuery] = useState('')
  const [genre, setGenre] = useState<string | null>(ALL_GENRES)
  const [retryCount, setRetryCount] = useState(0)
  const [trackToAddToPlaylist, setTrackToAddToPlaylist] = useState<MusicTrack | null>(null)
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [preselectedTrackForUpload, setPreselectedTrackForUpload] = useState<MusicTrack | null>(null)

  const [search, setSearch] = useState<SearchResultState>({
    results: [],
    isLoading: isDemoMode,
    error: null,
    forQuery: '',
    forGenre: ALL_GENRES,
  })

  const { debouncedValue, isPending } = useDebouncedValue(query, 280)
  const { playQueue } = usePlayer()

  // For regular users, Explore strictly queries the published catalog.
  // For admin, it queries depending on the selected admin tab.
  const hasQuery = debouncedValue.trim().length > 0
  const isCatalogBrowse = !isDemoMode && (!isAdmin || adminTab === 'published')
  const shouldSearch = isDemoMode || hasQuery || isCatalogBrowse
  const isStale =
    shouldSearch && (search.forQuery !== debouncedValue || search.forGenre !== genre)

  const isPublishedTab = !isDemoMode && (!isAdmin || adminTab === 'published')
  const rawResults = shouldSearch && !isStale ? search.results : []
  // In published category, guarantee that any track without audio is strictly excluded from results
  const filteredResults = isPublishedTab
    ? rawResults.filter((track) => {
        const effective = resolveEffectiveTrack(track) || track
        const hasAudio = Boolean(
          (typeof effective.storagePath === 'string' && effective.storagePath.trim().length > 0) ||
          (typeof effective.playbackUrl === 'string' && effective.playbackUrl.trim().length > 0) ||
          (typeof effective.audioSourceUrl === 'string' && effective.audioSourceUrl.trim().length > 0) ||
          getCachedAudioRecord(effective.providerTrackId),
        )
        return effective.isPlayable && hasAudio
      })
    : rawResults

  const error = shouldSearch && !isStale ? search.error : null
  const isLoading = shouldSearch && (isStale || search.isLoading || isPending)

  const state = resolveExploreSearchState({
    isDemo: isDemoMode,
    isSpotifyConfigured: true,
    isSpotifyConnected: true,
    query: isCatalogBrowse && filteredResults.length > 0 ? (debouncedValue.trim() || 'all') : debouncedValue,
    isLoading,
    error,
    results: filteredResults,
  })

  useEffect(() => {
    if (!shouldSearch) return

    const controller = new AbortController()

    // 1. Regular User OR Admin in Published Catalog: strictly fetch published catalog tracks!
    if (!isDemoMode && (!isAdmin || adminTab === 'published')) {
      fetchPublishedCatalogTracks({ searchQuery: debouncedValue, genre })
        .then((tracks) => {
          if (controller.signal.aborted) return
          // Deduplicate and filter to guarantee ONLY unique tracks with confirmed audio are shown in published explore!
          const seen = new Set<string>()
          const playableTracks: MusicTrack[] = []

          for (const t of tracks) {
            const effective = resolveEffectiveTrack(t) || t
            const normKey = normalizeTrackId(effective.providerTrackId || effective.id)
            if (normKey && seen.has(normKey)) continue
            if (normKey) seen.add(normKey)

            const hasAudio = Boolean(
              (typeof effective.storagePath === 'string' && effective.storagePath.trim().length > 0) ||
              (typeof effective.playbackUrl === 'string' && effective.playbackUrl.trim().length > 0) ||
              (typeof effective.audioSourceUrl === 'string' && effective.audioSourceUrl.trim().length > 0) ||
              getCachedAudioRecord(effective.providerTrackId),
            )
            if (effective.isPlayable && hasAudio) {
              playableTracks.push(effective)
            }
          }

          setSearch({
            results: playableTracks,
            isLoading: false,
            error: null,
            forQuery: debouncedValue,
            forGenre: genre,
          })
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          const message = err instanceof Error ? err.message : 'Unable to load published catalog.'
          setSearch({
            results: [],
            isLoading: false,
            error: message,
            forQuery: debouncedValue,
            forGenre: genre,
          })
        })
      return () => {
        controller.abort()
      }
    }

    // 2. Demo mode OR Admin in Spotify search tab: search external Spotify catalog
    provider
      .searchTracks(debouncedValue, { genre, signal: controller.signal })
      .then(async (tracks) => {
        if (controller.signal.aborted) return
        const enriched = await enrichTracksWithGlobalAudio(tracks)
        if (controller.signal.aborted) return
        setSearch({
          results: enriched,
          isLoading: false,
          error: null,
          forQuery: debouncedValue,
          forGenre: genre,
        })
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        const message =
          err instanceof Error
            ? err.message
            : 'Unable to reach the Spotify catalog. Please try again.'
        setSearch({
          results: [],
          isLoading: false,
          error: message,
          forQuery: debouncedValue,
          forGenre: genre,
        })
      })

    return () => {
      controller.abort()
    }
  }, [shouldSearch, debouncedValue, genre, provider, retryCount, isAdmin, adminTab, isDemoMode])

  // Synchronize latest global audio registry from remote server on mount
  useEffect(() => {
    void syncGlobalAudioFromRemote()
  }, [])

  // Listen for real-time changes to public.catalog_tracks from Supabase Realtime
  useEffect(() => {
    if (isDemoMode || !isSupabaseConfigured()) return

    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const channel = supabase
      .channel('public:catalog_tracks_explore')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'catalog_tracks' },
        () => {
          if (debounceTimer) clearTimeout(debounceTimer)
          debounceTimer = setTimeout(() => {
            void syncGlobalAudioFromRemote().then(() => {
              setRetryCount((c) => c + 1)
            })
          }, 300)
        },
      )
      .subscribe()

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      void supabase.removeChannel(channel)
    }
  }, [isDemoMode])

  // Re-fetch and re-enrich search results when an audio file is uploaded or published anywhere in Orbim
  useEffect(() => {
    function handleAudioUpdated(event?: Event) {
      const customEvt = event as
        | CustomEvent<{ providerTrackId?: string; audioUrl?: string; storagePath?: string }>
        | undefined
      const detail = customEvt?.detail

      if (detail?.providerTrackId) {
        const normTarget = normalizeTrackId(detail.providerTrackId)
        setSearch((prev) => {
          if (prev.results.length === 0) return prev
          const updated = prev.results.map((t) => {
            const normT = normalizeTrackId(t.providerTrackId)
            if (t.providerTrackId === detail.providerTrackId || (normT && normT === normTarget)) {
              return {
                ...t,
                isPlayable: true,
                playbackUrl: detail.audioUrl || t.playbackUrl,
                audioSourceUrl: detail.audioUrl || t.audioSourceUrl,
                storagePath: detail.storagePath || t.storagePath,
                audioSourceType: 'storage' as const,
              }
            }
            return t
          })
          return { ...prev, results: updated }
        })
      }
    }

    function handleCatalogChanged() {
      setRetryCount((c) => c + 1)
    }

    window.addEventListener('orbim:audio-updated', handleAudioUpdated)
    window.addEventListener('orbim:playlist-updated', handleAudioUpdated)
    window.addEventListener('orbim:catalog-published', handleCatalogChanged)
    window.addEventListener('orbim:catalog-updated', handleCatalogChanged)
    return () => {
      window.removeEventListener('orbim:audio-updated', handleAudioUpdated)
      window.removeEventListener('orbim:playlist-updated', handleAudioUpdated)
      window.removeEventListener('orbim:catalog-published', handleCatalogChanged)
      window.removeEventListener('orbim:catalog-updated', handleCatalogChanged)
    }
  }, [])

  const hasFilters = query.trim().length > 0 || genre !== null
  const isBusy = isLoading || isPending
  // Tracks with stored audio plus Spotify metadata-only tracks that this
  // session can play in-app are queue-able.
  const hasPlayableResults = state.results.some(
    (track) => track.isPlayable || Boolean(getCachedAudioRecord(track.providerTrackId)),
  )

  function clearFilters() {
    setQuery('')
    setGenre(ALL_GENRES)
  }

  function handleRetry() {
    setSearch((prev) => ({ ...prev, isLoading: true, error: null }))
    setRetryCount((prev) => prev + 1)
  }

  function renderResults() {
    if (isLoading) {
      return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div
              key={index}
              className="rounded-card border border-border bg-surface/40 p-3"
              aria-hidden="true"
            >
              <Skeleton className="aspect-square w-full rounded-xl" />
              <Skeleton className="mt-3 h-3 w-3/4" />
              <Skeleton className="mt-2 h-3 w-1/2" />
            </div>
          ))}
        </div>
      )
    }

    if (state.kind === 'not-configured') {
      return (
        <EmptyState
          icon={AlertCircle}
          title="Spotify is not configured"
          description="No Spotify Client ID is available to the browser, so catalog search cannot start. Add VITE_SPOTIFY_CLIENT_ID to your environment (or set CLIENT_ID_SPOTIFY and restart the dev server), then reload this page."
        />
      )
    }

    if (state.kind === 'idle' || state.kind === 'disconnected') {
      if (isCatalogBrowse && !hasQuery) {
        return (
          <EmptyState
            icon={Search}
            title={isPublishedTab ? 'Belum ada lagu ber-audio di katalog' : 'Tidak ada draft lagu'}
            description={
              isPublishedTab
                ? 'Lagu yang memiliki file audio yang valid akan muncul di sini setelah dipublikasikan oleh admin.'
                : 'Belum ada draft lagu dalam antrean manajemen.'
            }
          />
        )
      }
      return (
        <EmptyState
          icon={Search}
          title="Search tracks"
          description="Enter a track title, artist name, or album in the search box above to begin searching."
        />
      )
    }

    if (state.kind === 'error') {
      return (
        <EmptyState
          icon={AlertCircle}
          title="Search failed"
          description={state.error ?? 'Track search failed. Please try again in a moment.'}
          action={
            <Button variant="secondary" size="sm" onClick={handleRetry}>
              <RotateCcw aria-hidden="true" className="size-4" strokeWidth={1.75} />
              Retry
            </Button>
          }
        />
      )
    }

    if (state.kind === 'empty') {
      return (
        <EmptyState
          icon={Search}
          title="No tracks found"
          description={`No tracks found matching “${debouncedValue.trim()}”. Try searching with a different title or artist name.`}
          action={
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              Clear search
            </Button>
          }
        />
      )
    }

    if (state.results.length === 0) {
      return (
        <EmptyState
          icon={Search}
          title={
            isDemoMode
              ? 'No demo tracks match'
              : isCatalogBrowse && !hasQuery
                ? 'Belum ada lagu ber-audio di katalog'
                : 'No tracks available'
          }
          description={
            isDemoMode
              ? 'The offline fixture catalog has no tracks for this query or genre. Clear the filters to browse all fixtures.'
              : isCatalogBrowse && !hasQuery
                ? 'Lagu yang memiliki file audio yang valid akan muncul di sini setelah dipublikasikan oleh admin.'
                : 'Enter a search query to browse the music catalog.'
          }
          action={
            hasFilters ? (
              <Button variant="secondary" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      )
    }

    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {state.results.map((track) => (
          <TrackCard
            key={`${track.provider}-${track.providerTrackId}`}
            track={track}
            queue={state.results}
            onAdd={(t) => setTrackToAddToPlaylist(t)}
            onUploadAudio={
              isAdmin && !track.isPlayable
                ? (t) => {
                    setPreselectedTrackForUpload(t)
                    setIsUploadOpen(true)
                  }
                : undefined
            }
            onReplaceAudio={
              isAdmin && track.isPlayable
                ? (t) => {
                    setPreselectedTrackForUpload(t)
                    setIsUploadOpen(true)
                  }
                : undefined
            }
          />
        ))}
      </div>
    )
  }

  return (
    <>
      <PageHeader
        title="Explore"
        description={
          isDemoMode
            ? 'Development demo mode: the offline fixture catalog is active. Live Spotify search is disabled.'
            : 'Discover your favorite tracks in the catalog. Play available tracks with crystal clear audio on ORBIM.'
        }
        actions={
          <div className="flex items-center gap-2">
            {isAdmin ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setPreselectedTrackForUpload(null)
                  setIsUploadOpen(true)
                }}
                className="gap-1.5"
              >
                <Plus aria-hidden="true" className="size-4" strokeWidth={2} />
                Add Song with Audio
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              disabled={state.results.length === 0 || isBusy || !hasPlayableResults}
              onClick={() => playQueue(state.results, { label: 'Explore results' })}
            >
              <Play aria-hidden="true" className="size-4" strokeWidth={2} />
              Play results
            </Button>
          </div>
        }
      />

      {isAdmin && !isDemoMode ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-surface/80 p-1.5 text-xs">
          <span className="px-2 text-[11px] font-semibold tracking-wider text-muted uppercase">Admin View:</span>
          <button
            type="button"
            onClick={() => {
              setAdminTab('published')
              setQuery('')
            }}
            className={cn(
              'rounded-md px-3 py-1 font-medium transition-colors',
              adminTab === 'published'
                ? 'bg-accent text-accent-contrast shadow-sm'
                : 'text-muted hover:text-foreground',
            )}
          >
            Published Catalog
          </button>
          <button
            type="button"
            onClick={() => {
              setAdminTab('spotify')
              setQuery('')
            }}
            className={cn(
              'rounded-md px-3 py-1 font-medium transition-colors',
              adminTab === 'spotify'
                ? 'bg-accent text-accent-contrast shadow-sm'
                : 'text-muted hover:text-foreground',
            )}
          >
            Search Spotify Metadata
          </button>
        </div>
      ) : null}

      <div className="space-y-6">
        <section
          aria-label="Search"
          className="rounded-card border border-border bg-surface/50 p-3 sm:p-4"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-3">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] text-muted uppercase">
              <Sparkles aria-hidden="true" className="size-3" strokeWidth={2} />
              {isDemoMode ? 'Demo catalog' : 'Katalog Musik'}
            </span>
            <span className="text-[11px] font-medium text-accent">
              Katalog Audio ORBIM
            </span>
          </div>

          <SearchBar
            value={query}
            onChange={setQuery}
            resultLabel={
              isBusy
                ? 'Updating results…'
                : `${state.results.length} tracks match the current search`
            }
          />

          {isDemoMode ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] text-muted uppercase">
                <SlidersHorizontal aria-hidden="true" className="size-3" strokeWidth={2} />
                Genre
              </span>
              <button
                type="button"
                onClick={() => setGenre(ALL_GENRES)}
                aria-pressed={genre === null}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150',
                  'focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none',
                  genre === null
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-border bg-elevated/40 text-muted hover:border-border/80 hover:text-foreground',
                )}
              >
                All
              </button>
              {DEMO_GENRES.map((genreName) => (
                <button
                  key={genreName}
                  type="button"
                  onClick={() => setGenre(genreName === genre ? ALL_GENRES : genreName)}
                  aria-pressed={genre === genreName}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150',
                    'focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none',
                    genre === genreName
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-border bg-elevated/40 text-muted hover:border-border/80 hover:text-foreground',
                  )}
                >
                  {genreName}
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
            <p className="max-w-2xl text-[11px] leading-relaxed text-muted">
              {isDemoMode
                ? 'Fixture catalog for offline UI review.'
                : 'Pencarian metadata terhubung dengan Spotify. Unggah audio untuk membuat lagu dapat diputar dengan kualitas jernih di ORBIM.'}
            </p>
            {hasFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="rounded text-[11px] font-medium text-accent transition-colors hover:text-accent/80 focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        </section>

        <section aria-labelledby="results-heading" aria-busy={isBusy}>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="results-heading" className="text-sm font-semibold text-foreground">
              {isDemoMode
                ? hasFilters
                  ? 'Fixture results'
                  : 'Featured fixtures'
                : 'Track Search Results'}
            </h2>
            <p className="text-xs text-muted">
              {isBusy ? 'Searching…' : `${state.results.length} ${state.results.length === 1 ? 'track' : 'tracks'}`}
            </p>
          </div>

          {renderResults()}
        </section>
      </div>

      <SpotifyTrackUploadDialog
        open={isUploadOpen}
        onClose={() => {
          setIsUploadOpen(false)
          setPreselectedTrackForUpload(null)
        }}
        preselectedTrack={preselectedTrackForUpload}
        onSuccess={() => {
          setRetryCount((c) => c + 1)
        }}
      />

      <AddToPlaylistDialog
        track={trackToAddToPlaylist}
        onClose={() => setTrackToAddToPlaylist(null)}
      />
    </>
  )
}
