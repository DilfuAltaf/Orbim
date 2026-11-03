import { AlertCircle, Globe2, RotateCcw, ShieldCheck, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { CollaboratorList } from '@/components/playlist/CollaboratorList'
import { PageHeader } from '@/components/layout/PageHeader'
import { PlaylistCard } from '@/components/playlist/PlaylistCard'
import { SectionHeader } from '@/components/layout/SectionHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { demoViewer, mockPlaylists } from '@/data/mock'
import { useAuth } from '@/features/auth/auth-context'
import { initialsOf, pluralize } from '@/lib/format'
import { buttonVariants } from '@/lib/styles'
import { getDataSource } from '@/lib/supabase'
import { mapSupabasePlaylistRows } from '@/services/playlist/library-state'
import { resolveSharedPlaylists } from '@/services/playlist/shared-playlists'
import { fetchUserPlaylists } from '@/services/playlist/supabase-playlist'
import type { Playlist } from '@/types/music'

export function SharedPage() {
  const { user, profile, isConfigured, isLoading: isAuthLoading } = useAuth()
  const isDemo = getDataSource() === 'demo'

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
    const displayName = profile?.display_name
    setIsLoadingPlaylists(true)
    setLoadError(null)

    const { data, error } = await fetchUserPlaylists()
    if (error) {
      setLoadError(error.message)
      setRemotePlaylists([])
    } else if (data) {
      const mapped = mapSupabasePlaylistRows(data, currentUserId, displayName)
      setRemotePlaylists(mapped)
      setLoadError(null)
    }
    setIsLoadingPlaylists(false)
  }, [user, isConfigured, profile?.display_name])

  useEffect(() => {
    if (!user || !isConfigured) {
      return
    }

    const currentUserId = user.id
    const displayName = profile?.display_name
    let isMounted = true

    async function fetchShared() {
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

    fetchShared()

    return () => {
      isMounted = false
    }
  }, [user, isConfigured, profile?.display_name])

  const isBusy = isAuthLoading || (Boolean(user && isConfigured) && isLoadingPlaylists)

  const sharedPlaylists = resolveSharedPlaylists({
    user,
    isDemo,
    remotePlaylists,
    mockPlaylists,
  })

  const team = isDemo ? mockPlaylists.flatMap((playlist) => playlist.collaborators) : []
  const others = isDemo
    ? [...new Map(team.map((person) => [person.id, person])).values()].filter(
        (person) => person.id !== demoViewer.id,
      )
    : []

  return (
    <>
      <PageHeader
        title="Shared Playlists"
        description={
          user
            ? 'Playlists owned by other creators where you have been granted member or editor access.'
            : isDemo
              ? 'Playlists owned by someone else where you are listed as an editor. Nothing here is synced — edits would need the realtime layer from Phase 6.'
              : 'Playlists shared with your account. Sign in to view playlists you have been invited to collaborate on.'
        }
        actions={
          <Badge tone={isDemo ? 'violet' : 'accent'} className="py-1">
            {isDemo ? 'Phase 6 preview' : 'PostgreSQL RLS'}
          </Badge>
        }
      />

      <div className="space-y-7">
        <section
          aria-labelledby="invite-security-heading"
          className="rounded-card border border-border bg-surface/50 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-secondary/15 text-accent-secondary">
              <ShieldCheck aria-hidden="true" className="size-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="invite-security-heading" className="text-sm font-semibold">
                {isDemo ? 'How sharing will actually work' : 'Collaborative access control'}
              </h2>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
                {isDemo
                  ? 'Invitations are generated server-side, stored as hashes, and expire before they grant access. Membership and permissions are enforced by database policies, not by hiding buttons. None of that exists yet, so this page shows mock membership only.'
                  : 'Membership and permissions are enforced by PostgreSQL Row Level Security policies (public.is_playlist_member). Playlists shown here reflect active memberships granted to your account.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link to="/library" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                  Browse all playlists
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="shared-heading" className="space-y-4">
          <SectionHeader
            id="shared-heading"
            title="Shared with you"
            description={
              isDemo
                ? sharedPlaylists.length > 0
                  ? `${pluralize(sharedPlaylists.length, 'playlist')} from ${pluralize(others.length, 'collaborator')} across ${new Set(others.map((person) => person.location)).size} cities.`
                  : 'No invitations have been accepted in this build.'
                : user
                  ? sharedPlaylists.length > 0
                    ? `${pluralize(sharedPlaylists.length, 'playlist')} shared with you by other members.`
                    : 'No playlists have been shared with your account yet.'
                  : 'Sign in to access playlists shared with your account.'
            }
          />

          {isBusy ? (
            <div
              className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
              aria-busy="true"
              aria-label="Loading shared playlists"
            >
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="rounded-card border border-border bg-surface/40 p-4">
                  <Skeleton className="aspect-[4/3] w-full rounded-xl" />
                  <Skeleton className="mt-3 h-4 w-3/4 rounded" />
                  <Skeleton className="mt-2 h-3 w-1/2 rounded" />
                </div>
              ))}
            </div>
          ) : loadError !== null ? (
            <div className="rounded-card border border-border bg-surface/40 p-8 text-center">
              <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-red-400/10 text-red-400">
                <AlertCircle className="size-5" />
              </div>
              <p className="mt-3 text-sm font-medium text-foreground">Could not load shared playlists</p>
              <p className="mt-1 text-xs text-muted">{loadError}</p>
              <Button variant="secondary" size="sm" onClick={loadPlaylists} className="mt-4">
                <RotateCcw className="size-3.5" />
                Try again
              </Button>
            </div>
          ) : sharedPlaylists.length === 0 ? (
            <div className="rounded-card border border-dashed border-border bg-surface/40 p-8 text-center">
              <Users aria-hidden="true" className="mx-auto size-5 text-muted" strokeWidth={1.75} />
              <p className="mt-3 text-sm font-medium">
                {user ? 'Nothing shared with you yet' : 'Sign in to view shared playlists'}
              </p>
              <p className="mt-1 text-xs text-muted">
                {user
                  ? 'Accept a valid invitation from another creator to see their playlist here.'
                  : 'Playlists shared with your account are protected by Row Level Security.'}
              </p>
              {!user && !isDemo && (
                <Link
                  to="/login"
                  className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'mt-4' })}
                >
                  Sign in
                </Link>
              )}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {sharedPlaylists.map((playlist) => (
                <PlaylistCard key={playlist.id} playlist={playlist} />
              ))}
            </div>
          )}
        </section>

        {isDemo && others.length > 0 && (
          <section aria-labelledby="people-heading" className="space-y-4">
            <SectionHeader
              id="people-heading"
              title="People in your orbit"
              description="Mock collaborators attached to your playlists. Real identities come from Supabase profiles in Phase 4."
            />
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {others.map((person) => {
                const playlists = mockPlaylists.filter((playlist) =>
                  playlist.collaborators.some((collaborator) => collaborator.id === person.id),
                )

                return (
                  <li
                    key={person.id}
                    className="rounded-card border border-border bg-surface/50 p-4 transition-colors hover:border-border/80"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-elevated text-xs font-semibold text-foreground"
                      >
                        {initialsOf(person.displayName)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {person.displayName}
                        </p>
                        <p className="flex items-center gap-1 truncate text-[11px] text-muted">
                          <Globe2 aria-hidden="true" className="size-3" strokeWidth={1.75} />
                          {person.location}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/70 pt-3">
                      <CollaboratorList collaborators={playlists[0]?.collaborators ?? []} max={2} />
                      <span className="text-[11px] text-muted">
                        {pluralize(playlists.length, 'playlist')}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>
    </>
  )
}
