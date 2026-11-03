import {
  AlertCircle,
  ListMusic,
  Plus,
  RotateCcw,
  Search,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { PageHeader } from '@/components/layout/PageHeader'
import { SearchBar } from '@/components/music/SearchBar'
import { SpotifyTrackUploadDialog } from '@/components/music/SpotifyTrackUploadDialog'
import { CreatePlaylistDialog } from '@/components/playlist/CreatePlaylistDialog'
import { PlaylistCard } from '@/components/playlist/PlaylistCard'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  isOwnedByViewer,
  mockPlaylists,
  playlistsByRecentUpdate,
  searchPlaylists,
} from '@/data/mock'
import { useAuth } from '@/features/auth/auth-context'
import { pluralize } from '@/lib/format'
import { buttonVariants } from '@/lib/styles'
import { getDataSource } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  computeLibraryCounts,
  mapSupabasePlaylistRows,
  resolveLibraryPlaylists,
} from '@/services/playlist/library-state'
import { fetchUserPlaylists } from '@/services/playlist/supabase-playlist'
import type { Playlist } from '@/types/music'

type LibraryFilter = 'all' | 'owned' | 'shared'

const filters: Array<{ id: LibraryFilter; label: string }> = [
  { id: 'all', label: 'All playlists' },
  { id: 'owned', label: 'Yours' },
  { id: 'shared', label: 'Shared with you' },
]

export function LibraryPage() {
  const { user, profile, isConfigured, isLoading: isAuthLoading, isAdmin } = useAuth()
  const isDemo = getDataSource() === 'demo'

  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [query, setQuery] = useState('')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isAddTrackOpen, setIsAddTrackOpen] = useState(false)
  const [deletedDemoIds, setDeletedDemoIds] = useState<string[]>([])

  // Cloud playlists state
  const [remotePlaylists, setRemotePlaylists] = useState<Playlist[]>([])
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState<boolean>(() => Boolean(user && isConfigured))
  const [loadError, setLoadError] = useState<string | null>(null)

  const loadPlaylists = useCallback(async () => {
    if (!user || !isConfigured) {
      setIsLoadingPlaylists(false)
      setLoadError(null)
      return
    }

    const currentUserId = user.id
    setIsLoadingPlaylists(true)
    setLoadError(null)

    const { data, error } = await fetchUserPlaylists()
    if (error) {
      setLoadError(error.message)
      setRemotePlaylists([])
    } else if (data) {
      const mapped = mapSupabasePlaylistRows(data, currentUserId, profile?.display_name)
      setRemotePlaylists(mapped)
      setLoadError(null)
    }
    setIsLoadingPlaylists(false)
  }, [user, isConfigured, profile?.display_name])

  useEffect(() => {
    if (!user || !isConfigured) {
      return
    }

    let isMounted = true
    const currentUserId = user.id
    const displayName = profile?.display_name

    async function fetchInitial() {
      setIsLoadingPlaylists(true)
      const { data, error } = await fetchUserPlaylists()
      if (!isMounted) return
      if (error) {
        setLoadError(error.message)
        setRemotePlaylists([])
      } else if (data) {
        const mapped = mapSupabasePlaylistRows(data, currentUserId, displayName)
        setRemotePlaylists(mapped)
        setLoadError(null)
      }
      setIsLoadingPlaylists(false)
    }

    void fetchInitial()

    function handlePlaylistUpdated(event: Event) {
      const detail = (event as CustomEvent<{ playlistId?: string; action?: string }>).detail
      if (detail?.action === 'delete' && detail?.playlistId) {
        setDeletedDemoIds((prev) => [...prev, detail.playlistId!])
      }
      if (isMounted) {
        void loadPlaylists()
      }
    }

    window.addEventListener('orbim:playlist-updated', handlePlaylistUpdated)

    return () => {
      isMounted = false
      window.removeEventListener('orbim:playlist-updated', handlePlaylistUpdated)
    }
  }, [user, isConfigured, profile?.display_name, loadPlaylists])

  // Also handle demo deletions when unauthenticated
  useEffect(() => {
    if (user && isConfigured) return

    function handlePlaylistUpdated(event: Event) {
      const detail = (event as CustomEvent<{ playlistId?: string; action?: string }>).detail
      if (detail?.action === 'delete' && detail?.playlistId) {
        setDeletedDemoIds((prev) => [...prev, detail.playlistId!])
      }
    }

    window.addEventListener('orbim:playlist-updated', handlePlaylistUpdated)
    return () => {
      window.removeEventListener('orbim:playlist-updated', handlePlaylistUpdated)
    }
  }, [user, isConfigured])

  // Isolated playlists: authenticated user sees strictly their cloud playlists;
  // unauthenticated visitors see demo catalog only if demo mode is enabled.
  const basePlaylists = resolveLibraryPlaylists({
    user,
    isDemo,
    remotePlaylists,
    mockPlaylists,
  })

  const activePlaylists = deletedDemoIds.length > 0
    ? basePlaylists.filter((p) => !deletedDemoIds.includes(p.id))
    : basePlaylists

  const isOwned = (playlist: Playlist) =>
    user ? playlist.owner.id === user.id : isOwnedByViewer(playlist)

  const owned = activePlaylists.filter(isOwned)
  const shared = activePlaylists.filter((playlist) => !isOwned(playlist))

  const scoped =
    filter === 'owned' ? owned : filter === 'shared' ? shared : activePlaylists
  const visible = playlistsByRecentUpdate(searchPlaylists(scoped, query))

  const collaborators = new Set(
    activePlaylists.flatMap((playlist) =>
      playlist.collaborators.map((collaborator) => collaborator.id),
    ),
  )
  const trackCount = activePlaylists.reduce(
    (total, playlist) => total + playlist.trackEntries.length,
    0,
  )

  const counts: Record<LibraryFilter, number> = computeLibraryCounts(
    activePlaylists,
    user?.id,
  )

  const isBusy = isAuthLoading || (Boolean(user && isConfigured) && isLoadingPlaylists)

  return (
    <>
      <PageHeader
        title="Your Library"
        description={
          user
            ? `Personal cloud playlists and collaboration spaces for ${profile?.display_name || user.email}.`
            : 'Every playlist in the demo catalog, including the two shared with you. Sign in to save personal playlists.'
        }
        actions={
          <div className="flex items-center gap-2">
            {isAdmin ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsAddTrackOpen(true)}
                className="gap-1.5"
              >
                <Plus aria-hidden="true" className="size-4" strokeWidth={2} />
                Add Song
              </Button>
            ) : null}
            <Button size="sm" onClick={() => setIsCreateOpen(true)}>
              <Plus aria-hidden="true" className="size-4" strokeWidth={2} />
              New playlist
            </Button>
          </div>
        }
      />

      <div className="space-y-6">
        <section aria-label="Library summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-card border border-border bg-surface/50 p-4">
            <p className="text-[10px] font-semibold tracking-[0.14em] text-muted uppercase">
              Playlists
            </p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums">
              {isBusy ? '—' : activePlaylists.length}
            </p>
            <p className="mt-0.5 text-[11px] text-muted">
              {isBusy
                ? 'Loading…'
                : `${owned.length} yours · ${shared.length} shared`}
            </p>
          </div>
          <div className="rounded-card border border-border bg-surface/50 p-4">
            <p className="text-[10px] font-semibold tracking-[0.14em] text-muted uppercase">
              Collected tracks
            </p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums">
              {isBusy ? '—' : trackCount}
            </p>
            <p className="mt-0.5 text-[11px] text-muted">Across every playlist</p>
          </div>
          <div className="rounded-card border border-border bg-surface/50 p-4">
            <p className="text-[10px] font-semibold tracking-[0.14em] text-muted uppercase">
              Collaborators
            </p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums">
              {isBusy ? '—' : collaborators.size}
            </p>
            <p className="mt-0.5 text-[11px] text-muted">
              {user ? 'Active members' : 'Fictional people'}
            </p>
          </div>
          <div className="rounded-card border border-border bg-surface/50 p-4">
            <p className="text-[10px] font-semibold tracking-[0.14em] text-muted uppercase">
              Persistence
            </p>
            {user ? (
              <>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-emerald-400" />
                  <p className="text-sm font-medium text-foreground">Cloud Connected</p>
                </div>
                <p className="mt-0.5 text-[11px] text-muted">Supabase · RLS Active</p>
              </>
            ) : (
              <>
                <p className="mt-1.5 text-sm font-medium text-foreground">Demo Mode</p>
                <p className="mt-0.5 text-[11px] text-muted">Sign in to sync playlists</p>
              </>
            )}
          </div>
        </section>

        <section aria-label="Filter playlists" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="group" aria-label="Filter by ownership" className="flex flex-wrap gap-1.5">
              {filters.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={filter === item.id}
                  onClick={() => setFilter(item.id)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150',
                    'focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none',
                    filter === item.id
                      ? 'border-accent/40 bg-accent/10 text-accent'
                      : 'border-border bg-elevated/40 text-muted hover:border-border/80 hover:text-foreground',
                  )}
                >
                  {item.label}
                  <span className="ml-1.5 text-[10px] tabular-nums opacity-70">
                    {isBusy ? '…' : counts[item.id]}
                  </span>
                </button>
              ))}
            </div>

            <SearchBar
              id="library-search"
              value={query}
              onChange={setQuery}
              label="Search your playlists"
              placeholder="Search playlists"
              className="w-full sm:w-64"
              resultLabel={`${visible.length} playlists match`}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
            <p>
              {isBusy
                ? 'Loading playlists…'
                : loadError !== null
                  ? 'Unable to load playlists'
                  : visible.length === 0
                    ? 'No playlists to show'
                    : `${pluralize(visible.length, 'playlist')} · sorted by last update`}
            </p>
            {query.trim() ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="rounded font-medium text-accent transition-colors hover:text-accent/80 focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none"
              >
                Clear search
              </button>
            ) : null}
          </div>

          {isBusy ? (
            <div
              className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
              aria-busy="true"
              aria-label="Loading playlists"
            >
              {Array.from({ length: 3 }, (_, index) => (
                <div
                  key={index}
                  className="rounded-card border border-border bg-surface/40 p-5"
                  aria-hidden="true"
                >
                  <Skeleton className="h-5 w-1/2 rounded" />
                  <Skeleton className="mt-3 h-3.5 w-3/4 rounded" />
                  <Skeleton className="mt-2 h-3.5 w-1/3 rounded" />
                </div>
              ))}
            </div>
          ) : loadError !== null ? (
            <EmptyState
              icon={AlertCircle}
              title="Unable to load playlists"
              description={loadError}
              action={
                <Button variant="secondary" size="sm" onClick={loadPlaylists}>
                  <RotateCcw aria-hidden="true" className="size-4" strokeWidth={1.75} />
                  Try again
                </Button>
              }
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={filter === 'shared' ? Users : Search}
              title={query.trim() ? 'No playlist matches that search' : 'Nothing here yet'}
              description={
                query.trim()
                  ? `No playlist title, description or collaborator matches “${query.trim()}”. Try another phrase or clear the filter.`
                  : user
                    ? 'Create a playlist to collect tracks, then invite someone to build it with you.'
                    : 'No playlists available. Sign in to create your first personal playlist.'
              }
              action={
                query.trim() ? (
                  <Button variant="secondary" size="sm" onClick={() => setQuery('')}>
                    Clear search
                  </Button>
                ) : user ? (
                  <Button variant="secondary" size="sm" onClick={() => setIsCreateOpen(true)}>
                    <ListMusic aria-hidden="true" className="size-4" strokeWidth={1.75} />
                    New playlist
                  </Button>
                ) : (
                  <Link
                    to="/login"
                    className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                  >
                    Sign in
                  </Link>
                )
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((playlist) => (
                <PlaylistCard key={playlist.id} playlist={playlist} />
              ))}
            </div>
          )}
        </section>

        <p className="text-[11px] leading-relaxed text-muted">
          {user
            ? 'Personal playlists are stored with PostgreSQL Row Level Security. Only you and your invited collaborators can read and edit them.'
            : 'You are currently browsing the demo catalog. Sign in to save personal playlists and invite real collaborators.'}
        </p>
      </div>

      <CreatePlaylistDialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSuccess={() => void loadPlaylists()}
      />

      <SpotifyTrackUploadDialog
        open={isAddTrackOpen}
        onClose={() => setIsAddTrackOpen(false)}
        onSuccess={() => void loadPlaylists()}
      />
    </>
  )
}
