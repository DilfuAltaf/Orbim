import { UserMinus } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { useAuth } from '@/features/auth/auth-context'
import { useToast } from '@/features/feedback/toast-context'
import { sendPlaylistRemovalNotification } from '@/services/notification/notification-service'
import { kickCollaboratorFromPlaylist } from '@/services/playlist/supabase-playlist'
import type { Collaborator, Playlist } from '@/types/music'

export type KickCollaboratorDialogProps = {
  playlist: Playlist | null
  collaborator: Collaborator | null
  open: boolean
  onClose: () => void
  onKicked?: (collaboratorId: string) => void
}

export function KickCollaboratorDialog({
  playlist,
  collaborator,
  open,
  onClose,
  onKicked,
}: KickCollaboratorDialogProps) {
  const { notify } = useToast()
  const { user } = useAuth()
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!playlist || !collaborator) return null

  async function handleKick() {
    if (!playlist || !collaborator) return

    setIsSubmitting(true)
    const { error } = await kickCollaboratorFromPlaylist({
      playlistId: playlist.id,
      userId: collaborator.id,
    })
    setIsSubmitting(false)

    if (error) {
      notify({
        tone: 'info',
        title: 'Gagal mengeluarkan kolaborator',
        description: error.message,
      })
      return
    }

    // Tell the removed collaborator instead of dropping their access silently.
    const senderDisplayName =
      (user as unknown as { displayName?: string })?.displayName ||
      user?.user_metadata?.display_name ||
      user?.email?.split('@')[0] ||
      playlist.owner.displayName

    await sendPlaylistRemovalNotification({
      recipientUserId: collaborator.id,
      recipientDisplayName: collaborator.displayName,
      playlistId: playlist.id,
      playlistTitle: playlist.title,
      senderUserId: user?.id || playlist.owner.id,
      senderDisplayName,
    })

    notify({
      tone: 'success',
      title: 'Kolaborator Dikeluarkan',
      description: `“${collaborator.displayName}” tidak lagi memiliki akses kolaborasi ke playlist ini.`,
    })

    onKicked?.(collaborator.id)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Keluarkan Kolaborator"
      description={`Keluarkan ${collaborator.displayName} dari playlist “${playlist.title}”?`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Batal
          </Button>
          <Button
            variant="danger"
            onClick={handleKick}
            disabled={isSubmitting}
            className="gap-1.5"
          >
            <UserMinus className="size-4" />
            {isSubmitting ? 'Mengeluarkan…' : 'Keluarkan'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 py-2 text-xs text-muted">
        <p className="leading-relaxed">
          Pengguna ini tidak akan dapat menambahkan atau mengubah lagu dalam playlist{' '}
          <strong className="text-foreground">{playlist.title}</strong> lagi.
        </p>
      </div>
    </Dialog>
  )
}
