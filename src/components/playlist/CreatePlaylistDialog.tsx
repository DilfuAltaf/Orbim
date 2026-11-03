import { Sparkles, Users } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { TextField } from '@/components/ui/TextField'
import { useAuth } from '@/features/auth/auth-context'
import { useToast } from '@/features/feedback/toast-context'
import { buttonVariants } from '@/lib/styles'
import {
  createPlaylistInvitation,
  createSupabasePlaylist,
} from '@/services/playlist/supabase-playlist'
import type { Playlist } from '@/types/music'

export type CreatePlaylistDialogProps = {
  open: boolean
  onClose: () => void
  onSuccess?: (newPlaylist: Partial<Playlist> & { id: string; title: string }) => void
}

export function CreatePlaylistDialog({
  open,
  onClose,
  onSuccess,
}: CreatePlaylistDialogProps) {
  const { user } = useAuth()
  const { notify } = useToast()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [isCollaborative, setIsCollaborative] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function resetState() {
    setError(null)
    setTitle('')
    setDescription('')
    setIsCollaborative(false)
  }

  function handleClose() {
    if (isCreating) return
    resetState()
    onClose()
  }

  const isFormValid = title.trim().length > 0

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const trimmed = title.trim()
    if (!trimmed) {
      setError('Harap beri judul playlist Anda.')
      return
    }
    if (trimmed.length > 100) {
      setError('Judul tidak boleh melebihi 100 karakter.')
      return
    }

    setIsCreating(true)
    const { data, error: createError } = await createSupabasePlaylist({
      title: trimmed,
      description: description.trim() || undefined,
      visibility: isCollaborative ? 'shared' : 'private',
    })

    if (createError) {
      setIsCreating(false)
      setError(createError.message)
      notify({
        tone: 'info',
        title: 'Gagal membuat playlist',
        description: createError.message,
      })
      return
    }

    if (data) {
      // If collaboration is enabled, generate the invite token right away so
      // the owner can share the playlist link.
      if (isCollaborative) {
        const { rawToken } = await createPlaylistInvitation(data.id)
        if (rawToken && typeof navigator !== 'undefined') {
          const inviteUrl = `${window.location.origin}/invite/${rawToken}`
          try {
            await navigator.clipboard.writeText(inviteUrl)
            notify({
              tone: 'success',
              title: 'Tautan Kolaborasi Dibuat',
              description: 'Tautan undangan disalin ke clipboard! Berlaku 7 hari.',
            })
          } catch {
            // Clipboard fallback
          }
        }
      }

      setIsCreating(false)
      notify({
        tone: 'success',
        title: isCollaborative ? 'Playlist Kolaborasi Dibuat!' : 'Playlist dibuat!',
        description: `“${trimmed}” tersimpan di koleksi playlist Anda.`,
      })

      window.dispatchEvent(
        new CustomEvent('orbim:playlist-updated', {
          detail: { playlistId: data.id, action: 'create' },
        }),
      )

      resetState()
      onSuccess?.({ id: data.id, title: data.title })
      onClose()
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Buat Playlist Baru"
      description={
        user
          ? 'Beri judul dan deskripsi playlist. Anda juga dapat mengaktifkan kolaborasi dengan teman.'
          : 'Masuk dengan akun untuk membuat playlist permanen dan mengundang kolaborator.'
      }
      footer={
        user ? (
          <>
            <Button variant="secondary" onClick={handleClose} disabled={isCreating}>
              Batal
            </Button>
            <Button onClick={handleCreate} disabled={isCreating || !isFormValid}>
              {isCreating ? 'Membuat…' : 'Buat playlist'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={handleClose}>
              Batal
            </Button>
            <Link
              to="/login"
              className={buttonVariants()}
              onClick={handleClose}
            >
              Masuk untuk membuat
            </Link>
          </>
        )
      }
    >
      {user ? (
        <form onSubmit={handleCreate} className="space-y-4">
          {error ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">
              {error}
            </div>
          ) : null}

          <TextField
            id="create-playlist-title"
            label="Judul Playlist"
            placeholder="Contoh: Lagu Favorit Senja"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            disabled={isCreating}
          />

          <div className="space-y-1.5">
            <label
              htmlFor="create-playlist-description"
              className="block text-[11px] font-semibold tracking-[0.14em] text-muted uppercase"
            >
              Deskripsi (opsional)
            </label>
            <textarea
              id="create-playlist-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isCreating}
              placeholder="Ceritakan tentang playlist ini..."
              className="w-full resize-none rounded-lg border border-border bg-background/40 px-3 py-2 text-sm text-foreground placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none disabled:cursor-not-allowed"
            />
          </div>

          {/* Fitur Kolaborasi Playlist */}
          <div className="rounded-lg border border-border bg-surface/50 p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <label
                htmlFor="collaborative-toggle"
                className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer select-none"
              >
                <Users className="size-4 text-accent" />
                <span>Bikin Playlist Kolaborasi</span>
              </label>
              <input
                id="collaborative-toggle"
                type="checkbox"
                checked={isCollaborative}
                onChange={(e) => setIsCollaborative(e.target.checked)}
                className="size-4 rounded border-border text-accent focus:ring-accent accent-accent"
              />
            </div>

            {isCollaborative && (
              <p className="pt-2 border-t border-border/60 text-[11px] leading-relaxed text-muted bg-background/50 p-2 rounded">
                Tautan undangan kolaborasi unik (7 hari) akan otomatis dibuat dan disalin saat
                playlist disimpan.
              </p>
            )}
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-lg border border-border bg-background/40 p-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
              <Sparkles aria-hidden="true" className="size-4" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">Masuk untuk membuat playlist</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                Masuk dengan akun ORBIM untuk membuat playlist permanen, mengundang kolaborator
                dengan link, dan berbagi musik bersama teman.
              </p>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  )
}
