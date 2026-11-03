import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { useToast } from '@/features/feedback/toast-context'
import { getDataSource } from '@/lib/supabase'
import { deleteSupabasePlaylist } from '@/services/playlist/supabase-playlist'
import type { Playlist } from '@/types/music'

export type DeletePlaylistDialogProps = {
  playlist: Playlist | null
  open: boolean
  onClose: () => void
  onDeleted?: (playlistId: string) => void
}

export function DeletePlaylistDialog({
  playlist,
  open,
  onClose,
  onDeleted,
}: DeletePlaylistDialogProps) {
  const { notify } = useToast()
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isDemo = getDataSource() === 'demo'

  if (!playlist) return null

  async function handleDelete() {
    if (!playlist) return

    setError(null)
    setIsDeleting(true)

    if (isDemo) {
      // In demo mode, trigger local deletion event & feedback
      setIsDeleting(false)
      notify({
        tone: 'success',
        title: 'Playlist deleted',
        description: `“${playlist.title}” has been removed.`,
      })
      window.dispatchEvent(
        new CustomEvent('orbim:playlist-updated', {
          detail: { playlistId: playlist.id, action: 'delete' },
        }),
      )
      onDeleted?.(playlist.id)
      onClose()
      return
    }

    const { error: deleteError } = await deleteSupabasePlaylist(playlist.id)
    setIsDeleting(false)

    if (deleteError) {
      setError(deleteError.message)
      notify({
        tone: 'info',
        title: 'Could not delete playlist',
        description: deleteError.message,
      })
      return
    }

    notify({
      tone: 'success',
      title: 'Playlist deleted',
      description: `“${playlist.title}” has been permanently deleted.`,
    })

    window.dispatchEvent(
      new CustomEvent('orbim:playlist-updated', {
        detail: { playlistId: playlist.id, action: 'delete' },
      }),
    )

    onDeleted?.(playlist.id)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={isDeleting ? () => {} : onClose}
      title="Delete playlist"
      description="This action cannot be undone."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} disabled={isDeleting}>
            {isDeleting ? 'Deleting…' : 'Delete playlist'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3.5 text-sm">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-400" />
          <div className="space-y-1">
            <p className="font-medium text-foreground">
              Are you sure you want to delete <span className="text-red-400 font-semibold">“{playlist.title}”</span>?
            </p>
            <p className="text-xs text-muted leading-relaxed">
              All tracks in this playlist and active invitations will be permanently removed.
            </p>
          </div>
        </div>

        {error ? (
          <p className="text-xs text-red-400">{error}</p>
        ) : null}
      </div>
    </Dialog>
  )
}
