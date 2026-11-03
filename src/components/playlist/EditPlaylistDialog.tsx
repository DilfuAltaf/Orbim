import { useState, type FormEvent } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { TextField } from '@/components/ui/TextField'
import { useToast } from '@/features/feedback/toast-context'
import { getDataSource } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { updateSupabasePlaylist } from '@/services/playlist/supabase-playlist'
import type { Playlist, PlaylistVisibility } from '@/types/music'

export type EditPlaylistDialogProps = {
  playlist: Playlist | null
  open: boolean
  onClose: () => void
  onUpdated?: (updated: Playlist) => void
}

function EditPlaylistModalInner({
  playlist,
  open,
  onClose,
  onUpdated,
}: {
  playlist: Playlist
  open: boolean
  onClose: () => void
  onUpdated?: (updated: Playlist) => void
}) {
  const { notify } = useToast()
  const isDemo = getDataSource() === 'demo'

  const [title, setTitle] = useState(playlist.title)
  const [description, setDescription] = useState(playlist.description || '')
  const [visibility, setVisibility] = useState<PlaylistVisibility>(playlist.visibility)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setError('Playlist title cannot be empty.')
      return
    }
    if (trimmedTitle.length > 100) {
      setError('Playlist title must not exceed 100 characters.')
      return
    }
    if (description.trim().length > 500) {
      setError('Playlist description must not exceed 500 characters.')
      return
    }

    setIsSaving(true)

    if (isDemo) {
      const updatedPlaylist: Playlist = {
        ...playlist,
        title: trimmedTitle,
        description: description.trim() || undefined,
        visibility,
        updatedAt: new Date().toISOString(),
      }
      setIsSaving(false)
      notify({
        tone: 'success',
        title: 'Playlist updated',
        description: `“${trimmedTitle}” has been updated.`,
      })
      window.dispatchEvent(
        new CustomEvent('orbim:playlist-updated', {
          detail: { playlistId: playlist.id, action: 'update' },
        }),
      )
      onUpdated?.(updatedPlaylist)
      onClose()
      return
    }

    const { data, error: updateError } = await updateSupabasePlaylist({
      playlistId: playlist.id,
      title: trimmedTitle,
      description: description.trim() || undefined,
      visibility,
    })

    setIsSaving(false)

    if (updateError) {
      setError(updateError.message)
      notify({
        tone: 'info',
        title: 'Could not update playlist',
        description: updateError.message,
      })
      return
    }

    const updatedPlaylist: Playlist = {
      ...playlist,
      title: data?.title || trimmedTitle,
      description: data?.description || undefined,
      visibility: (data?.visibility as PlaylistVisibility) || visibility,
      updatedAt: data?.updated_at || new Date().toISOString(),
    }

    notify({
      tone: 'success',
      title: 'Playlist updated',
      description: `“${trimmedTitle}” has been saved.`,
    })

    window.dispatchEvent(
      new CustomEvent('orbim:playlist-updated', {
        detail: { playlistId: playlist.id, action: 'update' },
      }),
    )

    onUpdated?.(updatedPlaylist)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={isSaving ? () => {} : onClose}
      title="Edit playlist"
      description="Update your playlist title, description, or visibility settings."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <p className="text-xs text-red-400">{error}</p> : null}

        <TextField
          id="edit-playlist-title"
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          disabled={isSaving}
          placeholder="e.g. Chill After Hours"
        />

        <div className="space-y-1.5">
          <label
            htmlFor="edit-playlist-description"
            className="block text-[11px] font-semibold tracking-[0.14em] text-muted uppercase"
          >
            Description (optional)
          </label>
          <textarea
            id="edit-playlist-description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isSaving}
            placeholder="Give your playlist a description"
            className="w-full resize-none rounded-lg border border-border bg-background/40 px-3 py-2 text-sm text-foreground placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none disabled:cursor-not-allowed"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
            Visibility
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setVisibility('private')}
              className={cn(
                'flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-colors',
                visibility === 'private'
                  ? 'border-accent/50 bg-accent/10 text-foreground'
                  : 'border-border bg-surface/40 text-muted hover:border-border/80',
              )}
            >
              <span className="text-xs font-semibold">Private</span>
              <span className="text-[11px] text-muted">Only you can view and listen</span>
            </button>
            <button
              type="button"
              onClick={() => setVisibility('shared')}
              className={cn(
                'flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-colors',
                visibility === 'shared'
                  ? 'border-accent/50 bg-accent/10 text-foreground'
                  : 'border-border bg-surface/40 text-muted hover:border-border/80',
              )}
            >
              <span className="text-xs font-semibold">Shared</span>
              <span className="text-[11px] text-muted">Invite friends to collaborate</span>
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Badge tone="accent">Supabase RLS</Badge>
          <p className="text-[11px] text-muted">Only the playlist owner can edit these details.</p>
        </div>
      </form>
    </Dialog>
  )
}

export function EditPlaylistDialog(props: EditPlaylistDialogProps) {
  if (!props.playlist || !props.open) return null

  return (
    <EditPlaylistModalInner
      key={`${props.playlist.id}-${props.playlist.updatedAt || ''}`}
      playlist={props.playlist}
      open={props.open}
      onClose={props.onClose}
      onUpdated={props.onUpdated}
    />
  )
}
