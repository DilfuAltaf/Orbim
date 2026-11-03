import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { TrackArtwork } from '@/components/music/TrackArtwork'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { useAuth } from '@/features/auth/auth-context'
import { useToast } from '@/features/feedback/toast-context'
import { isSameTrack } from '@/features/player/playback-engine'
import { usePlayer } from '@/features/player/player-context'
import { formatDuration } from '@/lib/format'
import { deleteCatalogTrackAudio } from '@/services/catalog/global-catalog-service'
import type { MusicTrack } from '@/types/music'

export interface DeleteAudioDialogProps {
  open: boolean
  onClose: () => void
  track: MusicTrack | null
  onSuccess?: (track: MusicTrack) => void
}

export function DeleteAudioDialog({
  open,
  onClose,
  track,
  onSuccess,
}: DeleteAudioDialogProps) {
  const { user } = useAuth()
  const { notify } = useToast()
  const { currentTrack, stop } = usePlayer()

  const [isDeleting, setIsDeleting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  if (!track) return null

  async function handleDelete() {
    if (!track) return

    setIsDeleting(true)
    setErrorMessage(null)

    try {
      const result = await deleteCatalogTrackAudio({
        trackId: track.catalogTrackId || track.id,
        providerTrackId: track.providerTrackId,
        storagePath: track.storagePath,
        userEmail: user?.email,
      })

      if (!result.success) {
        throw result.error || new Error('Gagal menghapus file audio.')
      }

      // If current playing track is the deleted track, stop playback
      if (isSameTrack(currentTrack, track)) {
        stop()
      }

      notify({
        title: 'Audio Berhasil Dihapus',
        description: `File audio untuk "${track.title}" telah dihapus. Lagu kini kembali menjadi metadata Spotify.`,
        tone: 'success',
      })

      onSuccess?.(track)
      onClose()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Terjadi kesalahan saat menghapus audio.'
      setErrorMessage(message)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!isDeleting) {
          setErrorMessage(null)
          onClose()
        }
      }}
      title="Hapus Audio Lagu"
      description="Hapus file audio dari katalog ORBIM dan kembalikan lagu ke metadata Spotify."
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3.5 rounded-xl border border-border/80 bg-surface/60 p-3">
          <TrackArtwork track={track} className="size-14 shrink-0 rounded-lg shadow-sm" />
          <div className="min-w-0 flex-1">
            <h4 className="truncate text-sm font-semibold text-foreground">{track.title}</h4>
            <p className="truncate text-xs text-muted">{track.artistName}</p>
            <div className="mt-1 flex items-center gap-2">
              <Badge className="border-rose-500/30 bg-rose-500/10 text-[10px] text-rose-400">
                Audio Terpasang
              </Badge>
              {track.durationSeconds > 0 ? (
                <span className="text-[11px] text-muted">{formatDuration(track.durationSeconds)}</span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-xs leading-relaxed text-muted">
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-4 shrink-0 text-rose-400 mt-0.5" />
            <div>
              <p className="font-medium text-foreground">Konfirmasi Penghapusan Audio</p>
              <p className="mt-1">
                Lagu ini akan dicabut publikasinya dan file audio akan dihapus dari server/cloud.
                Lagu akan kembali menjadi metadata Spotify biasa dan tidak dapat diputar sampai audio baru diunggah.
              </p>
            </div>
          </div>
        </div>

        {errorMessage ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
            {errorMessage}
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-end gap-2.5 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isDeleting}
            onClick={() => {
              setErrorMessage(null)
              onClose()
            }}
          >
            Batal
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={isDeleting}
            onClick={handleDelete}
            className="gap-1.5"
          >
            {isDeleting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Menghapus...
              </>
            ) : (
              <>
                <Trash2 className="size-4" />
                Hapus Audio
              </>
            )}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
