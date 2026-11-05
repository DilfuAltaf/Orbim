import { Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import type { MusicTrack, Playlist } from '@/types/music'

export type RemoveTrackDialogProps = {
  playlist: Playlist | null
  track: MusicTrack | null
  open: boolean
  onClose: () => void
  onConfirm: (track: MusicTrack) => Promise<void>
}

export function RemoveTrackDialog({
  playlist,
  track,
  open,
  onClose,
  onConfirm,
}: RemoveTrackDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!playlist || !track) return null

  async function handleConfirm() {
    if (!track) return
    setIsSubmitting(true)
    try {
      await onConfirm(track)
      onClose()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Hapus Lagu dari Playlist"
      description={`Hapus lagu "${track.title}" dari playlist "${playlist.title}"? Lagu tidak akan dihapus dari katalog ORBIM atau penyimpanan audio.`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Batal
          </Button>
          <Button
            variant="danger"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="gap-1.5"
          >
            <Trash2 className="size-4" />
            {isSubmitting ? 'Menghapus…' : 'Hapus'}
          </Button>
        </div>
      }
    />
  )
}
