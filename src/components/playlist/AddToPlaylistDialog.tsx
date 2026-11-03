import { AlertCircle, Check, ListMusic, Loader2, Lock, LogIn, Plus, RefreshCw, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { CreatePlaylistDialog } from '@/components/playlist/CreatePlaylistDialog'
import { PlaylistArtwork } from '@/components/playlist/PlaylistArtwork'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { mockPlaylists } from '@/data/mock'
import { useAuth } from '@/features/auth/auth-context'
import { useToast } from '@/features/feedback/toast-context'
import { pluralize } from '@/lib/format'
import { buttonVariants } from '@/lib/styles'
import { getDataSource } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  addTrackToUserPlaylist,
  fetchUserWritablePlaylists,
  resolveAddToPlaylistUIState,
  type AddToPlaylistOption,
} from '@/services/playlist/add-to-playlist'
import type { MusicTrack, Playlist } from '@/types/music'

export type AddToPlaylistDialogProps = {
  track: MusicTrack | null
  onClose: () => void
  onSuccess?: (playlistId: string) => void
  onUploadAudio?: (track: MusicTrack) => void
  isDemo?: boolean
}

/**
 * Playlist picker for adding tracks to user playlists.
 *
 * In Supabase mode, loads only authorized playlists from the database, enforces duplicate
 * protection according to the database unique constraint, and confirms persistence before
 * displaying success feedback.
 *
 * In Demo mode, preserves mock-only offline behavior.
 */
export function AddToPlaylistDialog({
  track,
  onClose,
  onSuccess,
  onUploadAudio,
  isDemo: propIsDemo,
}: AddToPlaylistDialogProps) {
  const { user, isAdmin } = useAuth()
  const { notify } = useToast()

  const isDemo = propIsDemo ?? (getDataSource() === 'demo')

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [remotePlaylists, setRemotePlaylists] = useState<AddToPlaylistOption[]>([])
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState<boolean>(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState<boolean>(false)
  const [isCreateOpen, setIsCreateOpen] = useState<boolean>(false)

  // Fetch authorized playlists when dialog opens with a valid track in Supabase mode
  useEffect(() => {
    if (!track || isDemo || !user) return

    let isMounted = true

    async function loadPlaylists() {
      setIsLoadingPlaylists(true)
      setLoadError(null)
      setActionError(null)

      const { data, error } = await fetchUserWritablePlaylists(user!.id)
      if (!isMounted) return

      if (error) {
        setLoadError(error.message)
        setRemotePlaylists([])
      } else if (data) {
        setRemotePlaylists(data)
        setLoadError(null)
      }
      setIsLoadingPlaylists(false)
    }

    loadPlaylists()

    return () => {
      isMounted = false
    }
  }, [track, user, isDemo])

  function handleRetry() {
    if (!user || isDemo) return

    setIsLoadingPlaylists(true)
    setLoadError(null)
    setActionError(null)

    fetchUserWritablePlaylists(user.id).then(({ data, error }) => {
      if (error) {
        setLoadError(error.message)
        setRemotePlaylists([])
      } else if (data) {
        setRemotePlaylists(data)
        setLoadError(null)
      }
      setIsLoadingPlaylists(false)
    })
  }

  if (!track) return null
  const currentTrack = track

  const uiState = resolveAddToPlaylistUIState({
    user,
    isDemo,
    remotePlaylists,
    mockPlaylists,
    isLoading: isLoadingPlaylists,
    loadError,
  })

  async function handleConfirm() {
    if (!selectedId) return

    // 1. Explicit Demo Mode: isolate mock behavior
    if (isDemo) {
      const selectedMock = mockPlaylists.find((playlist) => playlist.id === selectedId)
      if (!selectedMock) return

      notify({
        tone: 'info',
        title: 'Demo only — nothing was saved',
        description: `“${currentTrack.title}” would be added to ${selectedMock.title}. Playlist saving arrives in Phase 5.`,
      })

      setSelectedId(null)
      setActionError(null)
      onClose()
      return
    }

    // 2. Supabase Mode: real database mutation
    if (!user) {
      const errorMsg = 'Silakan masuk ke akun Anda untuk menambahkan lagu ke playlist.'
      setActionError(errorMsg)
      notify({
        tone: 'info',
        title: 'Perlu Masuk Akun',
        description: errorMsg,
      })
      return
    }

    const selectedRemote = remotePlaylists.find((p) => p.id === selectedId)
    if (!selectedRemote) return

    setIsSaving(true)
    setActionError(null)

    const result = await addTrackToUserPlaylist({
      playlistId: selectedId,
      track: currentTrack,
    })

    setIsSaving(false)

    if (!result.success) {
      const errorMsg =
        result.error?.message ||
        (result.isDuplicate
          ? `“${currentTrack.title}” is already in this playlist.`
          : 'Failed to add track to playlist.')

      setActionError(errorMsg)

      notify({
        tone: 'info',
        title: result.isDuplicate ? 'Already in playlist' : 'Could not add track',
        description: errorMsg,
      })
      return
    }

    // Success confirmed by database mutation
    notify({
      tone: 'success',
      title: 'Added to playlist',
      description: `“${currentTrack.title}” was added to ${selectedRemote.title}.`,
    })

    onSuccess?.(selectedId)

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('orbim:playlist-updated', {
          detail: { playlistId: selectedId, track: currentTrack },
        }),
      )
    }

    setSelectedId(null)
    setActionError(null)
    onClose()
  }

  function renderContent() {
    if (uiState.type === 'guest') {
      return (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-full border border-border bg-elevated text-muted">
            <LogIn aria-hidden="true" className="size-6" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">Sign in required</h3>
          <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted">
            Sign in to your ORBIM account to view your playlists and add “{currentTrack.title}”.
          </p>
          <div className="mt-4">
            <Link
              to="/login"
              onClick={() => {
                setSelectedId(null)
                setActionError(null)
                onClose()
              }}
              className={buttonVariants({ variant: 'primary', size: 'sm' })}
            >
              Sign in to ORBIM
            </Link>
          </div>
        </div>
      )
    }

    if (uiState.type === 'loading') {
      return (
        <div className="flex flex-col items-center justify-center py-10 text-center" role="status">
          <Loader2 aria-hidden="true" className="size-6 animate-spin text-accent" />
          <span className="mt-2 text-xs text-muted">Loading your playlists...</span>
        </div>
      )
    }

    if (uiState.type === 'error') {
      return (
        <div className="flex flex-col items-center justify-center py-6 text-center" role="alert">
          <AlertCircle aria-hidden="true" className="mb-2 size-8 text-danger" />
          <h3 className="text-sm font-semibold text-foreground">Could not load playlists</h3>
          <p className="mt-1 max-w-xs text-xs text-muted">{uiState.message}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRetry}
            className="mt-4 inline-flex items-center gap-1.5"
          >
            <RefreshCw aria-hidden="true" className="size-3.5" />
            Retry
          </Button>
        </div>
      )
    }

    if (uiState.type === 'empty') {
      return (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-full border border-border bg-elevated text-muted">
            <ListMusic aria-hidden="true" className="size-6" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">Belum ada playlist</h3>
          <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted">
            Anda belum memiliki playlist. Buat playlist baru untuk mulai menyimpan lagu “{currentTrack.title}”.
          </p>
          <div className="mt-4">
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsCreateOpen(true)}
              className="gap-1.5"
            >
              <Plus aria-hidden="true" className="size-4" />
              Buat Playlist Baru
            </Button>
          </div>
        </div>
      )
    }

    // Populated state: either 'ready' (remote) or 'demo' (mock)
    const items =
      uiState.type === 'ready'
        ? uiState.playlists.map((p) => ({
            id: p.id,
            title: p.title,
            visibility: p.visibility,
            trackCount: p.trackCount,
            artworkPlaylist: {
              id: p.id,
              title: p.title,
              description: p.description,
              owner: { id: p.ownerId, displayName: 'You', location: '' },
              visibility: p.visibility,
              collaborators: [],
              trackEntries: [],
              createdAt: p.updatedAt,
              updatedAt: p.updatedAt,
            } satisfies Playlist,
          }))
        : uiState.playlists.map((p) => ({
            id: p.id,
            title: p.title,
            visibility: p.visibility,
            trackCount: p.trackEntries.length,
            artworkPlaylist: p,
          }))

    return (
      <fieldset>
        <legend className="sr-only">Choose a playlist</legend>

        <div className="mb-2.5 flex items-center justify-between">
          <p className="text-[11px] text-muted">Pilih playlist tujuan:</p>
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="flex items-center gap-1 text-xs font-medium text-accent hover:underline focus-visible:outline-none"
          >
            <Plus className="size-3.5" />
            <span>Playlist baru</span>
          </button>
        </div>

        {actionError && (
          <div
            className="mb-3 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
            role="alert"
          >
            <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}

        <ul className="-mx-1 max-h-72 space-y-1 overflow-y-auto">
          {items.map((playlist) => {
            const isSelected = playlist.id === selectedId

            return (
              <li key={playlist.id}>
                <label
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg border p-2 transition-colors',
                    isSelected
                      ? 'border-accent/40 bg-accent/[0.07]'
                      : 'border-transparent hover:border-border hover:bg-elevated/60',
                    'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/70',
                  )}
                >
                  <input
                    type="radio"
                    name="playlist"
                    value={playlist.id}
                    checked={isSelected}
                    onChange={() => {
                      setSelectedId(playlist.id)
                      setActionError(null)
                    }}
                    disabled={isSaving}
                    className="sr-only"
                  />
                  <PlaylistArtwork
                    playlist={playlist.artworkPlaylist}
                    className="size-10 shrink-0"
                    single
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {playlist.title}
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px] text-muted">
                      {playlist.visibility === 'shared' ? (
                        <Users aria-hidden="true" className="size-3" strokeWidth={1.75} />
                      ) : (
                        <Lock aria-hidden="true" className="size-3" strokeWidth={1.75} />
                      )}
                      {pluralize(playlist.trackCount, 'track')} ·{' '}
                      {playlist.visibility === 'shared' ? 'Shared' : 'Private'}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-full border',
                      isSelected
                        ? 'border-accent bg-accent text-accent-contrast'
                        : 'border-border text-transparent',
                    )}
                  >
                    <Check className="size-3" strokeWidth={2.5} />
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      </fieldset>
    )
  }

  function renderFooter() {
    if (uiState.type === 'guest') {
      return (
        <Button
          variant="secondary"
          onClick={() => {
            setSelectedId(null)
            setActionError(null)
            onClose()
          }}
        >
          Cancel
        </Button>
      )
    }

    if (uiState.type === 'loading' || uiState.type === 'error' || uiState.type === 'empty') {
      return (
        <>
          <Button
            variant="secondary"
            onClick={() => {
              setSelectedId(null)
              setActionError(null)
              onClose()
            }}
          >
            Cancel
          </Button>
          <Button disabled>Add track</Button>
        </>
      )
    }

    return (
      <>
        <Button
          variant="secondary"
          onClick={() => {
            setSelectedId(null)
            setActionError(null)
            onClose()
          }}
          disabled={isSaving}
        >
          Cancel
        </Button>
        <Button onClick={handleConfirm} disabled={!selectedId || isSaving}>
          {isSaving ? 'Adding...' : 'Add track'}
        </Button>
      </>
    )
  }

  return (
    <Dialog
      open={track !== null}
      onClose={() => {
        setSelectedId(null)
        setActionError(null)
        onClose()
      }}
      title="Add to playlist"
      description={`Choose a playlist for “${track.title}” by ${track.artistName}.`}
      footer={renderFooter()}
    >
      {renderContent()}

      {!track.isPlayable && isAdmin && onUploadAudio && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-accent/25 bg-accent/[0.06] p-3 text-xs">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">Want to play this song on ORBIM?</p>
            <p className="mt-0.5 text-[11px] text-muted">
              Upload your own audio file (.mp3, .wav, etc.) for full cloud playback.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            onClick={() => {
              const current = track
              setSelectedId(null)
              setActionError(null)
              onClose()
              onUploadAudio(current)
            }}
          >
            Upload Audio
          </Button>
        </div>
      )}

      {uiState.type === 'demo' && (
        <p className="mt-4 rounded-lg border border-border bg-background/40 px-3 py-2 text-[11px] leading-relaxed text-muted">
          Demo catalog: selecting a playlist does not write anything. Persistence, permissions
          and duplicate protection arrive with Supabase in Phase 5.
        </p>
      )}

      <CreatePlaylistDialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSuccess={(newPlaylist) => {
          setIsCreateOpen(false)
          setSelectedId(newPlaylist.id)
          if (user) {
            void fetchUserWritablePlaylists(user.id).then(({ data }) => {
              if (data) setRemotePlaylists(data)
            })
          }
        }}
      />
    </Dialog>
  )
}
