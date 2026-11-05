import { ArrowLeft, ListMusic, RotateCcw, Share2, ShieldCheck, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { PlaylistHeader, type PlaylistSortMode } from '@/components/playlist/PlaylistHeader'
import { PlaylistTrackList } from '@/components/playlist/PlaylistTrackList'
import { CollaboratorList } from '@/components/playlist/CollaboratorList'
import { SharePlaylistDialog } from '@/components/playlist/SharePlaylistDialog'
import { EditPlaylistDialog } from '@/components/playlist/EditPlaylistDialog'
import { DeletePlaylistDialog } from '@/components/playlist/DeletePlaylistDialog'
import { KickCollaboratorDialog } from '@/components/playlist/KickCollaboratorDialog'
import { RemoveTrackDialog } from '@/components/playlist/RemoveTrackDialog'
import { AddToPlaylistDialog } from '@/components/playlist/AddToPlaylistDialog'
import { SpotifyTrackUploadDialog } from '@/components/music/SpotifyTrackUploadDialog'
import { AttachAudioDialog } from '@/components/music/AttachAudioDialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  findPlaylist,
  isOwnedByViewer,
  playlistDurationSeconds,
  playlistTracks,
} from '@/data/mock'
import { useAuth } from '@/features/auth/auth-context'
import { useToast } from '@/features/feedback/toast-context'
import { formatRelativeTime, formatTotalLength, pluralize } from '@/lib/format'
import { buttonVariants } from '@/lib/styles'
import { getDataSource, getSupabaseAuthHeaders, isSupabaseConfigured, supabase } from '@/lib/supabase'
import {
  getAllLocalUsers,
  getLocalPlaylists,
  getLocalPlaylistTracks,
  saveLocalPlaylist,
  saveLocalPlaylistTrack,
} from '@/services/auth/local-auth-store'
import { mapPlaylistTrackRow } from '@/services/playlist/track-mapping'
import {
  fetchServerFullPlaylist,
  removeTrackFromPlaylist,
} from '@/services/playlist/supabase-playlist'
import {
  enrichTracksWithGlobalAudio,
  getCachedAudioRecord,
  resolveEffectiveTrack,
} from '@/services/audio/global-audio-registry'
import type {
  Collaborator,
  MusicTrack,
  Playlist,
  PlaylistTrackEntry,
  PlaylistVisibility,
} from '@/types/music'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function PlaylistPage() {
  const { playlistId } = useParams<{ playlistId: string }>()
  const navigate = useNavigate()
  const { user, isAdmin } = useAuth()
  const { notify } = useToast()
  const [isShareOpen, setIsShareOpen] = useState(false)
  const [isAddTrackOpen, setIsAddTrackOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [collaboratorToKick, setCollaboratorToKick] = useState<Collaborator | null>(null)
  const [trackToRemove, setTrackToRemove] = useState<MusicTrack | null>(null)
  const [sortMode, setSortMode] = useState<PlaylistSortMode>('original')
  const [attachAudioTrack, setAttachAudioTrack] = useState<MusicTrack | null>(null)
  const [trackToAddToPlaylist, setTrackToAddToPlaylist] = useState<MusicTrack | null>(null)
  const [isAttachAudioOpen, setIsAttachAudioOpen] = useState(false)
  const isDemo = getDataSource() === 'demo'

  // Demo fixtures resolve only in explicit demo mode; live mode always reads Supabase.
  const mock = isDemo && playlistId ? findPlaylist(playlistId) : null
  const [remotePlaylist, setRemotePlaylist] = useState<Playlist | null>(null)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [isLoadingRemote, setIsLoadingRemote] = useState<boolean>(() => !mock && Boolean(playlistId))

  const fetchRemotePlaylist = useCallback(async () => {
    if (!playlistId) return null

    // 1. Check local storage
    const localList = getLocalPlaylists()
    const foundLocal = localList.find((p) => p.id === playlistId)
    if (foundLocal) {
      const localTracks = getLocalPlaylistTracks(playlistId)
      return {
        data: {
          id: foundLocal.id,
          title: foundLocal.title,
          description: foundLocal.description,
          owner_id: foundLocal.owner_id,
          visibility: foundLocal.visibility,
          created_at: foundLocal.created_at,
          updated_at: foundLocal.updated_at,
          playlist_tracks: localTracks.map((t) => ({
            ...t,
            added_at: t.created_at,
          })),
          playlist_members: [
            {
              id: 'member-' + foundLocal.owner_id,
              playlist_id: foundLocal.id,
              user_id: foundLocal.owner_id,
              role: 'owner',
              joined_at: foundLocal.created_at,
            },
          ],
        },
        error: null,
      }
    }

    // 2. Query dev server API /api/playlists?playlistId=...
    const serverFull = await fetchServerFullPlaylist(playlistId)
    if (serverFull?.playlist) {
      saveLocalPlaylist(serverFull.playlist)
      for (const t of serverFull.playlist_tracks || []) {
        saveLocalPlaylistTrack(t)
      }
      return {
        data: {
          id: serverFull.playlist.id,
          title: serverFull.playlist.title,
          description: serverFull.playlist.description,
          owner_id: serverFull.playlist.owner_id,
          visibility: serverFull.playlist.visibility,
          created_at: serverFull.playlist.created_at,
          updated_at: serverFull.playlist.updated_at,
          playlist_tracks: (serverFull.playlist_tracks || []).map((t) => ({
            ...t,
            added_at: t.created_at,
          })),
          playlist_members: serverFull.playlist_members || [],
        },
        error: null,
      }
    }

    // 3. Fallback: Supabase remote fetch (only valid UUIDs)
    if (!UUID_REGEX.test(playlistId)) {
      return null
    }

    const remoteRes = await supabase
      .from('playlists')
      .select(`
        id,
        title,
        description,
        owner_id,
        visibility,
        created_at,
        updated_at,
        playlist_tracks (*),
        playlist_members (*)
      `)
      .eq('id', playlistId)
      .maybeSingle()

    return remoteRes
  }, [playlistId])

  // Reconcile collaborators from the dev-server registry and Supabase so a
  // collaborator joining from another account shows up without a manual refresh.
  const refreshCollaborators = useCallback(async () => {
    if (!playlistId || !UUID_REGEX.test(playlistId)) return

    const incoming: Collaborator[] = []
    const localUsers = getAllLocalUsers()
    const userDisplayName =
      (user as unknown as { displayName?: string })?.displayName ||
      user?.user_metadata?.display_name ||
      user?.email?.split('@')[0] ||
      'You'

    // 1. Dev-server registry (local accounts and cross-browser sessions).
    try {
      const authHeaders = await getSupabaseAuthHeaders()
      const res = await fetch(
        `/api/playlists/collaborators?playlistId=${encodeURIComponent(playlistId)}`,
        { headers: { ...authHeaders } },
      )
      if (res.ok) {
        const payload = (await res.json()) as {
          collaborators?: Array<{
            userId?: string
            displayName?: string
            location?: string | null
            role?: string
            joinedAt?: string
          }>
        }
        for (const col of payload.collaborators || []) {
          if (!col.userId) continue
          incoming.push({
            id: col.userId,
            displayName: col.displayName || 'Editor',
            location: col.location || '',
            role: (col.role as Collaborator['role']) || 'editor',
            joinedAt: col.joinedAt || new Date().toISOString(),
          })
        }
      }
    } catch {
      // Non-blocking
    }

    // 2. Supabase membership rows (live mode).
    if (isSupabaseConfigured()) {
      try {
        const { data: rows } = await supabase
          .from('playlist_members')
          .select('user_id, role, joined_at')
          .eq('playlist_id', playlistId)

        for (const row of rows || []) {
          incoming.push({
            id: row.user_id,
            displayName:
              (row.user_id === user?.id
                ? userDisplayName
                : localUsers.find((u) => u.id === row.user_id)?.displayName) || 'Editor',
            location: '',
            role: (row.role as Collaborator['role']) || 'editor',
            joinedAt: row.joined_at,
          })
        }
      } catch {
        // Non-blocking
      }
    }

    if (incoming.length === 0) return

    setRemotePlaylist((prev) => {
      if (!prev) return prev
      const existingIds = new Set(prev.collaborators.map((c) => c.id))
      const extra = incoming.filter((c) => !existingIds.has(c.id))
      if (extra.length === 0) return prev
      return { ...prev, collaborators: [...prev.collaborators, ...extra] }
    })
  }, [playlistId, user])

  type RemotePlaylistResult = Awaited<ReturnType<typeof fetchRemotePlaylist>>

  const applyRemoteResult = useCallback(
    (result: RemotePlaylistResult) => {
      if (!result) return

      const { data, error } = result
      setIsLoadingRemote(false)

      if (error) {
        setRemoteError(error.message)
        setRemotePlaylist(null)
        return
      }

    if (!data) {
      setRemotePlaylist(null)
      return
    }

    const sortedTracks = (data.playlist_tracks || []).sort(
      (a, b) => Number(a.position) - Number(b.position),
    )
    const entries: PlaylistTrackEntry[] = sortedTracks.map((pt) => {
      let track = mapPlaylistTrackRow(pt as never, supabase)
      const effective = resolveEffectiveTrack(track)
      if (effective) {
        track = effective
      } else if (!track.isPlayable && track.providerTrackId) {
        const cached = getCachedAudioRecord(track.providerTrackId)
        if (cached) {
          track = {
            ...track,
            isPlayable: true,
            playbackUrl: cached.audioUrl,
            audioSourceUrl: cached.audioUrl,
            storagePath: cached.storagePath,
            audioSourceType: 'storage',
          }
        }
      }
      return {
        track,
        addedBy: {
          id: pt.added_by || '',
          displayName: pt.added_by === data.owner_id ? 'Owner' : 'Collaborator',
          location: '',
        },
        addedAt: pt.added_at,
      }
    })

    const userDisplayName =
      (user as unknown as { displayName?: string })?.displayName ||
      user?.user_metadata?.display_name ||
      user?.email?.split('@')[0] ||
      'You'

    const localUsers = getAllLocalUsers()
    const ownerUser = localUsers.find((u) => u.id === data.owner_id)
    const ownerName =
      data.owner_id === user?.id
        ? userDisplayName
        : ownerUser?.displayName ||
          (data.owner_id.includes('dilfu')
            ? 'dilfualtaf07'
            : data.owner_id.includes('dilpuu')
              ? 'dilpuu'
              : 'Owner')

    const members: Collaborator[] = (data.playlist_members || []).map((pm) => {
      const matched = localUsers.find((u) => u.id === pm.user_id)
      const isOwner = pm.user_id === data.owner_id
      const resolvedName =
        matched?.displayName ||
        (pm.user_id === user?.id ? userDisplayName : null) ||
        (pm.user_id.includes('dilfu')
          ? 'dilfualtaf07'
          : pm.user_id.includes('dilpuu')
            ? 'dilpuu'
            : null) ||
        (isOwner ? ownerName : 'Editor')

      return {
        id: pm.user_id,
        displayName: resolvedName,
        location: (matched as unknown as { location?: string })?.location || '',
        role: pm.role as 'owner' | 'editor',
        joinedAt: pm.joined_at,
      }
    })

    setRemotePlaylist({
      id: data.id,
      title: data.title,
      description: data.description || undefined,
      owner: {
        id: data.owner_id,
        displayName: ownerName,
        location: (ownerUser as unknown as { location?: string })?.location || '',
      },
      visibility: data.visibility as PlaylistVisibility,
      collaborators: members,
      trackEntries: entries,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    })

    // Extra server-registered collaborators (cross-browser sync).
    void refreshCollaborators()

    // Asynchronously resolve global audio for any remaining unplayable tracks
    const unplayable = entries.filter((e) => !e.track.isPlayable).map((e) => e.track)
    if (unplayable.length > 0) {
      enrichTracksWithGlobalAudio(unplayable).then((enriched) => {
        const anyPlayable = enriched.some((t) => t.isPlayable)
        if (anyPlayable) {
          const map = new Map(enriched.map((t) => [t.providerTrackId, t]))
          setRemotePlaylist((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              trackEntries: prev.trackEntries.map((e) => {
                const match = map.get(e.track.providerTrackId)
                return match && match.isPlayable ? { ...e, track: match } : e
              }),
            }
          })
        }
      })
    }
  },
  [refreshCollaborators, user?.id],
)

  const loadRemote = useCallback(
    async (showLoadingSpinner = false) => {
      if (showLoadingSpinner) {
        setIsLoadingRemote(true)
      }
      setRemoteError(null)
      applyRemoteResult(await fetchRemotePlaylist())
    },
    [applyRemoteResult, fetchRemotePlaylist],
  )

  useEffect(() => {
    if (mock || !playlistId || !UUID_REGEX.test(playlistId)) return

    let isMounted = true
    fetchRemotePlaylist().then((result) => {
      if (!isMounted) return
      applyRemoteResult(result)
    })

    return () => {
      isMounted = false
    }
  }, [applyRemoteResult, fetchRemotePlaylist, mock, playlistId])

  // Refresh when a track is added from another surface so the view reflects Supabase.
  useEffect(() => {
    if (!playlistId || !UUID_REGEX.test(playlistId)) return

    function handlePlaylistUpdated(event: Event) {
      const detail = (event as CustomEvent<{ playlistId?: string; action?: string }>).detail
      if (detail?.action === 'delete' && detail?.playlistId === playlistId) {
        navigate('/explore')
        return
      }
      if (!detail?.playlistId || detail.playlistId === playlistId) {
        void loadRemote()
      }
    }

    window.addEventListener('orbim:playlist-updated', handlePlaylistUpdated)
    window.addEventListener('orbim:audio-updated', handlePlaylistUpdated)
    return () => {
      window.removeEventListener('orbim:playlist-updated', handlePlaylistUpdated)
      window.removeEventListener('orbim:audio-updated', handlePlaylistUpdated)
    }
  }, [playlistId, loadRemote, navigate])

  // Live collaborator sync: Supabase realtime when available, plus a light
  // poll of the server registry so joins land even without realtime enabled.
  useEffect(() => {
    if (mock || !playlistId || !UUID_REGEX.test(playlistId)) return

    const channel = isSupabaseConfigured()
      ? supabase
          .channel(`playlist-members-${playlistId}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'playlist_members',
              filter: `playlist_id=eq.${playlistId}`,
            },
            () => {
              void refreshCollaborators()
            },
          )
          .subscribe()
      : null

    const timer = setInterval(() => {
      void refreshCollaborators()
    }, 5000)

    function handleFocus() {
      void refreshCollaborators()
    }

    window.addEventListener('focus', handleFocus)

    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', handleFocus)
      if (channel) {
        void supabase.removeChannel(channel)
      }
    }
  }, [mock, playlistId, refreshCollaborators])

  const playlist = mock || remotePlaylist

  const sortedEntries = useMemo(() => {
    if (!playlist) return []
    const list = [...playlist.trackEntries]

    switch (sortMode) {
      case 'title':
        return list.sort((a, b) => a.track.title.localeCompare(b.track.title))
      case 'artist':
        return list.sort((a, b) => a.track.artistName.localeCompare(b.track.artistName))
      case 'duration':
        return list.sort((a, b) => (a.track.durationSeconds || 0) - (b.track.durationSeconds || 0))
      case 'date':
        return list.sort(
          (a, b) => new Date(b.addedAt || 0).getTime() - new Date(a.addedAt || 0).getTime(),
        )
      case 'original':
      default:
        return list
    }
  }, [playlist, sortMode])

  if (isLoadingRemote && !playlist) {
    return (
      <div className="flex h-48 items-center justify-center">
        <p className="text-sm text-muted">Loading playlist…</p>
      </div>
    )
  }

  if (remoteError !== null) {
    return (
      <div className="space-y-6">
        <h1 className="sr-only">Playlist unavailable</h1>
        <EmptyState
          icon={ListMusic}
          title="Unable to load this playlist"
          description={remoteError}
          action={
            <Button variant="secondary" size="sm" onClick={() => void loadRemote()}>
              <RotateCcw aria-hidden="true" className="size-4" strokeWidth={1.75} />
              Try again
            </Button>
          }
        />
      </div>
    )
  }

  if (!playlist) {
    return (
      <div className="space-y-6">
        <h1 className="sr-only">Playlist not found</h1>

        <Link
          to="/explore"
          className="inline-flex items-center gap-1.5 rounded text-xs font-medium text-muted transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
          Back to Explore
        </Link>

        <EmptyState
          icon={ListMusic}
          title="Playlist not found"
          description={`No playlist matches “${playlistId ?? 'unknown'}”.`}
          action={
            <Link to="/explore" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Explore tracks
            </Link>
          }
        />
      </div>
    )
  }

  const isOwned = user ? playlist.owner.id === user.id || isAdmin : isOwnedByViewer(playlist)
  const userMember = user
    ? playlist.collaborators.find(
        (c) => c.id === user.id || (c as unknown as { userId?: string }).userId === user.id,
      )
    : null
  const isEditor = userMember?.role === 'editor'

  const canManageTracks = (track?: MusicTrack, entry?: PlaylistTrackEntry): boolean => {
    if (isDemo) return true
    if (isOwned || isAdmin) return true
    if (!user || !isEditor) return false
    if (!track && !entry) {
      return playlist.trackEntries.some(
        (e) => e.addedBy.id === user.id || e.track.addedBy === user.id,
      )
    }
    const addedById = entry?.addedBy?.id || track?.addedBy
    return Boolean(addedById && addedById === user.id)
  }

  const tracks = playlistTracks(playlist)

  async function handleConfirmRemoveTrack(track: MusicTrack) {
    if (!playlist) return

    if (!canManageTracks(track)) {
      notify({
        tone: 'info',
        title: 'Could not remove track',
        description: 'You are only authorized to remove tracks you added.',
      })
      return
    }

    const removePredicate = (e: PlaylistTrackEntry) =>
      e.track.providerTrackId !== track.providerTrackId && e.track.id !== track.id

    if (isDemo) {
      setRemotePlaylist((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          trackEntries: prev.trackEntries.filter(removePredicate),
        }
      })
      notify({
        tone: 'success',
        title: 'Track removed',
        description: `“${track.title}” removed from playlist.`,
      })
      return
    }

    const { error } = await removeTrackFromPlaylist({
      playlistId: playlist.id,
      trackId: track.id,
      providerTrackId: track.providerTrackId,
    })

    if (error) {
      notify({
        tone: 'info',
        title: 'Could not remove track',
        description: error.message,
      })
      return
    }

    setRemotePlaylist((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        trackEntries: prev.trackEntries.filter(removePredicate),
      }
    })

    notify({
      tone: 'success',
      title: 'Track removed',
      description: `“${track.title}” removed from playlist.`,
    })

    window.dispatchEvent(
      new CustomEvent('orbim:playlist-updated', {
        detail: { playlistId: playlist.id, action: 'track-removed' },
      }),
    )

    void loadRemote()
  }

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-muted">
        <Link
          to="/explore"
          className="inline-flex items-center gap-1.5 rounded font-medium transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
          Explore
        </Link>
        <span aria-hidden="true" className="text-border">
          /
        </span>
        <span className="truncate text-muted">{playlist.title}</span>
      </nav>

      <PlaylistHeader
        playlist={playlist}
        sortMode={sortMode}
        onSortChange={setSortMode}
        onShare={() => setIsShareOpen(true)}
        onAddTrack={isAdmin ? () => setIsAddTrackOpen(true) : undefined}
        onEdit={isOwned ? () => setIsEditOpen(true) : undefined}
        onDelete={isOwned ? () => setIsDeleteOpen(true) : undefined}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 rounded-card border border-border bg-surface/40 p-2 sm:p-4">
          <PlaylistTrackList
            playlist={playlist}
            trackEntries={sortedEntries}
            sortMode={sortMode}
            onSortChange={setSortMode}
            onAdd={(track) => setTrackToAddToPlaylist(track)}
            onAddTrack={isAdmin ? () => setIsAddTrackOpen(true) : undefined}
            onRemoveTrack={(track) => setTrackToRemove(track)}
            canRemoveTrack={(track, entry) => canManageTracks(track, entry)}
            onAttachAudio={
              isAdmin
                ? (track) => {
                    setAttachAudioTrack(track)
                    setIsAttachAudioOpen(true)
                  }
                : undefined
            }
          />
        </div>

        <aside className="space-y-4">
          <section
            aria-labelledby="collaborators-heading"
            className="rounded-card border border-border bg-surface/50 p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h2
                id="collaborators-heading"
                className="flex items-center gap-2 text-sm font-semibold"
              >
                <Users aria-hidden="true" className="size-4 text-accent" strokeWidth={1.75} />
                Collaborators
              </h2>
              <span className="text-[11px] text-muted">{playlist.collaborators.length}</span>
            </div>

            <CollaboratorList
              collaborators={playlist.collaborators}
              variant="detailed"
              className="mt-4"
              onKickCollaborator={isOwned ? (col) => setCollaboratorToKick(col) : undefined}
              currentUserId={user?.id}
            />

            <Button
              variant="secondary"
              size="sm"
              className="mt-4 w-full"
              onClick={() => setIsShareOpen(true)}
            >
              <Share2 aria-hidden="true" className="size-4" strokeWidth={1.75} />
              Invite someone
            </Button>
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              {UUID_REGEX.test(playlist.id)
                ? 'Create SHA-256 hashed 7-day invitations for collaborators.'
                : 'Invitation links are active for personal cloud playlists.'}
            </p>
          </section>

          <section
            aria-labelledby="details-heading"
            className="rounded-card border border-border bg-surface/50 p-4"
          >
            <h2 id="details-heading" className="text-sm font-semibold">
              Playlist details
            </h2>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Owner</dt>
                <dd className="truncate text-foreground">
                  {isOwned ? 'You' : playlist.owner.displayName}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Visibility</dt>
                <dd>
                  <Badge
                    tone={playlist.visibility === 'shared' ? 'accent' : 'neutral'}
                    className="py-0.5"
                  >
                    {playlist.visibility === 'shared' ? 'Shared' : 'Private'}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Tracks</dt>
                <dd className="tabular-nums text-foreground">
                  {pluralize(tracks.length, 'track')}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Length</dt>
                <dd className="tabular-nums text-foreground">
                  {formatTotalLength(playlistDurationSeconds(playlist))}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Created</dt>
                <dd className="text-foreground">{formatRelativeTime(playlist.createdAt)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted">Updated</dt>
                <dd className="text-foreground">{formatRelativeTime(playlist.updatedAt)}</dd>
              </div>
            </dl>
          </section>

          <section
            aria-labelledby="playback-heading"
            className="rounded-card border border-border bg-surface/50 p-4"
          >
            <h2
              id="playback-heading"
              className="flex items-center gap-2 text-sm font-semibold"
            >
              <ShieldCheck
                aria-hidden="true"
                className="size-4 text-accent-secondary"
                strokeWidth={1.75}
              />
              Playback status
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {tracks.filter((track) => track.isPlayable).length} of {tracks.length}{' '}
              {pluralize(tracks.length, 'track')} have a playable audio source. Tracks without one
              ({tracks.filter((track) => !track.isPlayable).length}) keep their metadata only and
              link out to the source platform instead of streaming fabricated audio.
            </p>
          </section>
        </aside>
      </div>

      <SharePlaylistDialog
        playlist={playlist}
        open={isShareOpen}
        onClose={() => setIsShareOpen(false)}
      />

      <SpotifyTrackUploadDialog
        open={isAddTrackOpen}
        onClose={() => setIsAddTrackOpen(false)}
        initialPlaylistId={playlist.id}
        onSuccess={() => void loadRemote()}
      />

      <AttachAudioDialog
        open={isAttachAudioOpen}
        onClose={() => {
          setIsAttachAudioOpen(false)
          setAttachAudioTrack(null)
        }}
        playlistId={playlist.id}
        track={attachAudioTrack}
        onSuccess={() => void loadRemote()}
      />

      <EditPlaylistDialog
        playlist={playlist}
        open={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        onUpdated={(updated) => setRemotePlaylist(updated)}
      />

      <DeletePlaylistDialog
        playlist={playlist}
        open={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        onDeleted={() => navigate('/library')}
      />

      <AddToPlaylistDialog
        track={trackToAddToPlaylist}
        onClose={() => setTrackToAddToPlaylist(null)}
      />

      <KickCollaboratorDialog
        playlist={playlist}
        collaborator={collaboratorToKick}
        open={Boolean(collaboratorToKick)}
        onClose={() => setCollaboratorToKick(null)}
        onKicked={(kickedId) => {
          setRemotePlaylist((prev) => {
            if (!prev) return prev
            return {
              ...prev,
              collaborators: prev.collaborators.filter(
                (c) => c.id !== kickedId && (c as unknown as { userId?: string }).userId !== kickedId,
              ),
            }
          })
          void loadRemote()
        }}
      />

      <RemoveTrackDialog
        playlist={playlist}
        track={trackToRemove}
        open={Boolean(trackToRemove)}
        onClose={() => setTrackToRemove(null)}
        onConfirm={handleConfirmRemoveTrack}
      />
    </div>
  )
}
