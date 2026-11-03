import { Check, Copy, Link2, ShieldCheck } from 'lucide-react'
import { useState, useEffect } from 'react'

import { CollaboratorList } from '@/components/playlist/CollaboratorList'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { useAuth } from '@/features/auth/auth-context'
import { useToast } from '@/features/feedback/toast-context'
import { getSupabaseAuthHeaders } from '@/lib/supabase'
import { createPlaylistInvitation } from '@/services/playlist/supabase-playlist'
import type { Playlist } from '@/types/music'

type SharePlaylistDialogProps = {
  playlist: Playlist
  open: boolean
  onClose: () => void
}

export function SharePlaylistDialog({ playlist, open, onClose }: SharePlaylistDialogProps) {
  const { user } = useAuth()
  const { notify } = useToast()
  const [isGenerating, setIsGenerating] = useState(false)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Pre-load active invitation token if one already exists for this playlist
  useEffect(() => {
    if (!open) return
    let active = true

    async function checkExisting() {
      try {
        const authHeaders = await getSupabaseAuthHeaders()
        const res = await fetch(`/api/invitations?playlistId=${encodeURIComponent(playlist.id)}`, {
          headers: { ...authHeaders },
        })
        if (res.ok) {
          const payload = (await res.json()) as {
            invitations?: Array<{ playlistId: string; rawToken?: string; expiresAt?: string }>
          }
          if (active && payload?.invitations) {
            const existing = payload.invitations.find(
              (inv) =>
                inv.playlistId === playlist.id &&
                (!inv.expiresAt || new Date(inv.expiresAt).getTime() > Date.now()),
            )
            if (existing && existing.rawToken) {
              setInviteUrl(`${window.location.origin}/invite/${existing.rawToken}`)
            }
          }
        }
      } catch {
        // Non-blocking
      }
    }

    void checkExisting()
    return () => {
      active = false
    }
  }, [open, playlist.id])

  async function handleGenerateInvite(e?: React.MouseEvent) {
    e?.preventDefault?.()
    e?.stopPropagation?.()
    setErrorMsg(null)
    setIsGenerating(true)

    try {
      const { rawToken, error } = await createPlaylistInvitation(playlist.id)
      setIsGenerating(false)

      if (error) {
        setErrorMsg(error.message)
        notify({
          tone: 'info',
          title: 'Could not create invite',
          description: error.message,
        })
        return
      }

      if (rawToken) {
        const url = `${window.location.origin}/invite/${rawToken}`
        setInviteUrl(url)
        notify({
          tone: 'success',
          title: 'Tautan undangan dibuat',
          description: 'Berlaku selama 7 hari.',
        })
      }
    } catch (err) {
      setIsGenerating(false)
      const msg = err instanceof Error ? err.message : 'Gagal membuat tautan'
      setErrorMsg(msg)
    }
  }

  async function handleCopy() {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      notify({
        tone: 'success',
        title: 'Tautan disalin ke clipboard',
      })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      notify({
        tone: 'info',
        title: 'Gagal menyalin tautan',
        description: 'Silakan salin teks tautan secara manual.',
      })
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Undang Kolaborator"
      description={`Bagikan “${playlist.title}” agar teman dapat menambahkan dan mengelola lagu bersama.`}
      footer={<Button onClick={onClose}>Tutup</Button>}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-border bg-background/40 p-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <Link2 aria-hidden="true" className="size-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">Tautan Undangan 7 Hari</p>
              <Badge tone="accent">Aktif</Badge>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Setiap undangan dienkripsi dan berlaku selama 7 hari. Teman yang menerima tautan akan
              langsung menjadi editor playlist.
            </p>

            {user ? (
              <div className="mt-3">
                {inviteUrl ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={inviteUrl}
                        className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground focus-visible:outline-none"
                      />
                      <Button
                        size="sm"
                        type="button"
                        variant="secondary"
                        onClick={handleCopy}
                        className="shrink-0"
                      >
                        {copied ? (
                          <>
                            <Check aria-hidden="true" className="size-3.5" />
                            Disalin
                          </>
                        ) : (
                          <>
                            <Copy aria-hidden="true" className="size-3.5" />
                            Salin
                          </>
                        )}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted">
                      Bagikan tautan ini ke temanmu. Temanmu hanya perlu masuk untuk bergabung.
                    </p>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    type="button"
                    onClick={handleGenerateInvite}
                    disabled={isGenerating}
                  >
                    {isGenerating ? 'Membuat tautan…' : 'Buat tautan undangan'}
                  </Button>
                )}
                {errorMsg ? <p className="mt-2 text-xs text-red-400">{errorMsg}</p> : null}
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted">
                Masuk untuk membuat tautan undangan playlist ini.
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 border-t border-border/70 pt-3">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
            Kolaborator dengan akses ({playlist.collaborators.length})
          </p>
          <CollaboratorList
            collaborators={playlist.collaborators}
            variant="detailed"
            className="mt-3"
          />
        </div>

        <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-muted">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
          Izin kolaborasi diamankan secara otomatis oleh PostgreSQL Row Level Security.
        </p>
      </div>
    </Dialog>
  )
}
