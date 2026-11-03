import { ArrowRight, Compass, Globe2, Music, Pause, Play, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { SectionHeader } from '@/components/layout/SectionHeader'
import { DeleteAudioDialog } from '@/components/music/DeleteAudioDialog'
import { SpotifyTrackUploadDialog } from '@/components/music/SpotifyTrackUploadDialog'
import { TrackArtwork } from '@/components/music/TrackArtwork'
import { TrackRow } from '@/components/music/TrackRow'
import { AddToPlaylistDialog } from '@/components/playlist/AddToPlaylistDialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { site } from '@/config/site'
import { useAuth } from '@/features/auth/auth-context'
import { isSameTrack } from '@/features/player/playback-engine'
import { usePlayer } from '@/features/player/player-context'
import { formatDuration } from '@/lib/format'
import { buttonVariants } from '@/lib/styles'
import { getDataSource, supabase } from '@/lib/supabase'
import { resolveHomeRecentTracks } from '@/services/playlist/home-playlists'
import { fetchRecentlyAddedCatalogTracks } from '@/services/catalog/global-catalog-service'
import { mergeRecentlyAddedTracks } from '@/services/catalog/recently-added'
import type { MusicTrack } from '@/types/music'

/** Page size for the Home "Recently added" catalog section. */
const RECENT_PAGE_SIZE = 6

export function HomePage() {
  const { isConfigured, isAdmin } = useAuth()
  const { currentTrack, isPlaying, playTrack, togglePlayback } = usePlayer()
  const isDemo = getDataSource() === 'demo'

  // Recently Added is a strict view of the published global catalog.
  const [recentCatalogTracks, setRecentCatalogTracks] = useState<MusicTrack[]>([])
  const [isLoadingRecent, setIsLoadingRecent] = useState(false)
  const [recentError, setRecentError] = useState<string | null>(null)
  const [hasMoreRecent, setHasMoreRecent] = useState(false)
  const [isLoadingMoreRecent, setIsLoadingMoreRecent] = useState(false)
  const [recentOffset, setRecentOffset] = useState(0)

  // Audio CRUD dialog states
  const [trackToDeleteAudio, setTrackToDeleteAudio] = useState<MusicTrack | null>(null)
  const [trackToAddToPlaylist, setTrackToAddToPlaylist] = useState<MusicTrack | null>(null)
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [preselectedTrackForUpload, setPreselectedTrackForUpload] = useState<MusicTrack | null>(null)

  // Reads the newest published catalog tracks that carry stored audio.
  const refreshRecent = useCallback(async () => {
    if (isDemo || !isConfigured) return

    setIsLoadingRecent(true)
    setRecentError(null)

    try {
      const { tracks, hasMore } = await fetchRecentlyAddedCatalogTracks({
        limit: RECENT_PAGE_SIZE,
        offset: 0,
      })
      setRecentCatalogTracks(tracks)
      setRecentOffset(RECENT_PAGE_SIZE)
      setHasMoreRecent(hasMore)
    } catch (err: unknown) {
      setRecentError(err instanceof Error ? err.message : 'Unable to load the catalog.')
    } finally {
      setIsLoadingRecent(false)
    }
  }, [isConfigured, isDemo])

  const loadMoreRecent = useCallback(async () => {
    if (isDemo || !isConfigured || isLoadingMoreRecent) return

    setIsLoadingMoreRecent(true)
    setRecentError(null)

    try {
      const { tracks, hasMore } = await fetchRecentlyAddedCatalogTracks({
        limit: RECENT_PAGE_SIZE,
        offset: recentOffset,
      })
      setRecentCatalogTracks((previous) =>
        mergeRecentlyAddedTracks({ existing: previous, incoming: tracks }),
      )
      setRecentOffset((offset) => offset + RECENT_PAGE_SIZE)
      setHasMoreRecent(hasMore)
    } catch (err: unknown) {
      setRecentError(err instanceof Error ? err.message : 'Unable to load more tracks.')
    } finally {
      setIsLoadingMoreRecent(false)
    }
  }, [isConfigured, isDemo, isLoadingMoreRecent, recentOffset])

  useEffect(() => {
    void refreshRecent()
  }, [refreshRecent])

  // New publications or audio updates refresh the section automatically
  useEffect(() => {
    if (isDemo || !isConfigured) return

    let timer: ReturnType<typeof setTimeout> | null = null
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void refreshRecent()
      }, 300)
    }

    window.addEventListener('orbim:catalog-published', scheduleRefresh)
    window.addEventListener('orbim:catalog-updated', scheduleRefresh)
    window.addEventListener('orbim:audio-updated', scheduleRefresh)

    const channel = supabase
      .channel('public:catalog_tracks_home')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'catalog_tracks' },
        scheduleRefresh,
      )
      .subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('orbim:catalog-published', scheduleRefresh)
      window.removeEventListener('orbim:catalog-updated', scheduleRefresh)
      window.removeEventListener('orbim:audio-updated', scheduleRefresh)
      void supabase.removeChannel(channel)
    }
  }, [isConfigured, isDemo, refreshRecent])

  // Demo mode keeps its labelled fixtures; live mode shows only the catalog.
  const recentTracks = isDemo
    ? resolveHomeRecentTracks({ isDemo: true, limit: 6 })
    : recentCatalogTracks

  const featuredTrack = recentTracks[0] ?? null
  const isFeaturedPlaying = Boolean(featuredTrack && isSameTrack(currentTrack, featuredTrack) && isPlaying)

  function handlePlayFeatured() {
    if (!featuredTrack) return
    if (isSameTrack(currentTrack, featuredTrack)) {
      togglePlayback()
      return
    }
    playTrack(featuredTrack, { queue: recentTracks, label: 'Featured track' })
  }

  return (
    <div className="space-y-10 lg:space-y-12">
      <section className="relative overflow-hidden rounded-card border border-border bg-surface/60 p-5 sm:p-8 lg:p-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 70% at 85% 10%, rgba(183,243,107,0.10) 0%, transparent 62%), radial-gradient(55% 65% at 10% 95%, rgba(167,139,250,0.12) 0%, transparent 65%)',
          }}
        />

        <div className="relative grid items-center gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div>
            <Badge tone="accent">
              {isDemo ? 'Demo Mode · Offline Fixtures' : 'ORBIM Platform · Audio Stream'}
            </Badge>
            <h1 className="mt-4 max-w-xl text-3xl leading-[1.1] font-semibold tracking-tight sm:text-4xl lg:text-[2.75rem]">
              {site.tagline}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
              {site.description} Dengarkan musik favorit dengan kualitas audio jernih langsung dari cloud storage ORBIM.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              <Link to="/explore" className={buttonVariants()}>
                Explore tracks
                <ArrowRight aria-hidden="true" className="size-4" strokeWidth={2} />
              </Link>
            </div>

            <dl className="mt-7 flex flex-wrap gap-x-6 gap-y-3 border-t border-border/70 pt-5 text-xs">
              <div>
                <dt className="text-muted">Published Tracks</dt>
                <dd className="mt-0.5 text-sm font-medium text-foreground">
                  {recentTracks.length}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Audio Stream</dt>
                <dd className="mt-0.5 text-sm font-medium text-foreground">
                  High-Fidelity
                </dd>
              </div>
              <div>
                <dt className="text-muted">Security</dt>
                <dd className="mt-0.5 text-sm font-medium text-foreground">
                  PostgreSQL RLS
                </dd>
              </div>
              <div>
                <dt className="text-muted">Catalog</dt>
                <dd className="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Globe2 aria-hidden="true" className="size-3.5 text-accent" strokeWidth={1.75} />
                  ORBIM DB
                </dd>
              </div>
            </dl>
          </div>

          <div className="relative mx-auto w-full max-w-sm lg:max-w-none">
            {featuredTrack ? (
              <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-surface/80 p-4 shadow-xl backdrop-blur transition-all duration-300 hover:border-accent/40">
                <div className="relative aspect-square overflow-hidden rounded-xl">
                  <TrackArtwork track={featuredTrack} className="size-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent" />
                  <div className="absolute right-3 bottom-3 left-3 flex items-end justify-between">
                    <div>
                      <Badge className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-400">
                        Spotlight
                      </Badge>
                      <h3 className="mt-1.5 max-w-[200px] truncate text-base font-semibold text-foreground">
                        {featuredTrack.title}
                      </h3>
                      <p className="max-w-[200px] truncate text-xs text-muted">
                        {featuredTrack.artistName}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handlePlayFeatured}
                      aria-label={isFeaturedPlaying ? 'Pause featured track' : 'Play featured track'}
                      className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-accent-contrast shadow-lg shadow-background/50 transition hover:scale-105 hover:bg-accent/90"
                    >
                      {isFeaturedPlaying ? (
                        <Pause className="size-5" />
                      ) : (
                        <Play className="size-5 fill-current ml-0.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-xs text-muted">
                  <span>{formatDuration(featuredTrack.durationSeconds)}</span>
                  {isAdmin ? (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setPreselectedTrackForUpload(featuredTrack)
                          setIsUploadOpen(true)
                        }}
                        className="h-7 gap-1 px-2 text-[11px] text-muted hover:text-foreground"
                      >
                        <Upload className="size-3" />
                        Ganti Audio
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setTrackToDeleteAudio(featuredTrack)}
                        className="h-7 gap-1 px-2 text-[11px] text-red-400 hover:bg-red-500/10 hover:text-red-300"
                      >
                        <Trash2 className="size-3" />
                        Hapus Audio
                      </Button>
                    </div>
                  ) : (
                    <span className="text-[11px] text-accent">Ready to stream</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex aspect-square flex-col items-center justify-center gap-3 rounded-card border border-dashed border-border bg-surface/40 p-6 text-center">
                <Music aria-hidden="true" className="size-8 text-muted" strokeWidth={1.5} />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Siap Mendengarkan Musik
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    Temukan lagu di katalog atau unggah file audio untuk mulai memutar lagu favoritmu di ORBIM.
                  </p>
                </div>
                <Link
                  to="/explore"
                  className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                >
                  <Compass className="size-3.5" />
                  Jelajahi Explore
                </Link>
              </div>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="recent-heading" className="space-y-4">
        <SectionHeader
          id="recent-heading"
          title="Recently added"
          description={
            isDemo
              ? 'Demo fixtures for offline UI review — the live catalog is not connected in demo mode.'
              : 'Daftar lagu terbaru yang dipublikasikan di ORBIM dan memiliki file audio yang siap diputar.'
          }
          action={
            <Link
              to="/explore"
              className="inline-flex items-center gap-1.5 rounded text-xs font-medium text-accent transition-colors hover:text-accent/80 focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none"
            >
              Explore all
              <ArrowRight aria-hidden="true" className="size-3.5" strokeWidth={2} />
            </Link>
          }
        />
        {!isDemo && isLoadingRecent && recentTracks.length === 0 ? (
          <div
            className="rounded-card border border-border bg-surface/40 p-3"
            aria-busy="true"
            aria-label="Loading recently added tracks"
          >
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="flex items-center gap-3 px-1 py-2">
                <Skeleton className="size-10 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-3.5 w-2/3 rounded" />
                  <Skeleton className="mt-2 h-3 w-1/3 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : recentTracks.length === 0 ? (
          <div className="rounded-card border border-border bg-surface/50 p-6 text-center text-xs text-muted">
            <p className="font-medium text-foreground">Belum ada lagu yang dipublikasikan</p>
            <p className="mt-1">
              {recentError
                ? recentError
                : 'Lagu akan muncul di sini setelah audio diunggah dan dipublikasikan ke katalog ORBIM.'}
            </p>
            <Link
              to="/explore"
              className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'mt-3' })}
            >
              <Compass aria-hidden="true" className="size-3.5" />
              Explore tracks
            </Link>
          </div>
        ) : (
          <div className="rounded-card border border-border bg-surface/50 p-2 sm:p-3">
            <ul>
              {recentTracks.map((track, index) => (
                <TrackRow
                  key={`${track.provider}-${track.providerTrackId}`}
                  track={track}
                  position={index + 1}
                  queue={recentTracks}
                  queueLabel="Recently added"
                  onAdd={(t) => setTrackToAddToPlaylist(t)}
                  onUploadAudio={
                    isAdmin
                      ? (t) => {
                          setPreselectedTrackForUpload(t)
                          setIsUploadOpen(true)
                        }
                      : undefined
                  }
                  onReplaceAudio={
                    isAdmin
                      ? (t) => {
                          setPreselectedTrackForUpload(t)
                          setIsUploadOpen(true)
                        }
                      : undefined
                  }
                  onDeleteAudio={
                    isAdmin
                      ? (t) => {
                          setTrackToDeleteAudio(t)
                        }
                      : undefined
                  }
                />
              ))}
            </ul>

            {!isDemo && hasMoreRecent ? (
              <div className="border-t border-border/70 px-2 pt-3 pb-1 text-center">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isLoadingMoreRecent}
                  onClick={() => void loadMoreRecent()}
                >
                  {isLoadingMoreRecent ? 'Loading…' : 'Load more tracks'}
                </Button>
              </div>
            ) : null}

            {recentError ? (
              <p role="alert" className="px-2 pt-2 pb-1 text-[11px] text-rose-300">
                {recentError}
              </p>
            ) : null}
          </div>
        )}
      </section>

      <DeleteAudioDialog
        open={Boolean(trackToDeleteAudio)}
        onClose={() => setTrackToDeleteAudio(null)}
        track={trackToDeleteAudio}
        onSuccess={() => {
          void refreshRecent()
        }}
      />

      <SpotifyTrackUploadDialog
        open={isUploadOpen}
        onClose={() => {
          setIsUploadOpen(false)
          setPreselectedTrackForUpload(null)
        }}
        preselectedTrack={preselectedTrackForUpload}
        onSuccess={() => {
          void refreshRecent()
        }}
      />

      <AddToPlaylistDialog
        track={trackToAddToPlaylist}
        onClose={() => setTrackToAddToPlaylist(null)}
      />
    </div>
  )
}
