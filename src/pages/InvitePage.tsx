import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  LogIn,
  Music2,
  RefreshCw,
  ShieldCheck,
  UserCheck,
} from 'lucide-react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { site } from '@/config/site'
import { useAuth } from '@/features/auth/auth-context'
import { useToast } from '@/features/feedback/toast-context'
import { buttonVariants } from '@/lib/styles'
import {
  acceptPlaylistInvitation,
  previewPlaylistInvitation,
} from '@/services/playlist/supabase-playlist'
import {
  classifyInvitationFailure,
  invitationFailureMessage,
  isRecoverableFailure,
  type InvitationFailureKind,
} from '@/services/playlist/invitation-lifecycle'

interface PreviewState {
  valid: boolean
  status?: string
  errorKind?: InvitationFailureKind
  playlistId?: string
  playlistTitle?: string
  inviterName?: string
  role?: string
}

export function InvitePage() {
  const { token } = useParams<{ token: string }>()
  const { user } = useAuth()
  const { notify } = useToast()
  const navigate = useNavigate()

  const [isLoadingPreview, setIsLoadingPreview] = useState(true)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionError, setActionError] = useState<{
    kind: InvitationFailureKind
    message: string
  } | null>(null)
  const [successInfo, setSuccessInfo] = useState<{
    playlistId: string
    playlistTitle?: string
    role: string
    isAlreadyMember?: boolean
  } | null>(null)

  const loadPreview = useCallback(async () => {
    if (!token || token.trim().length < 16) {
      setPreview({
        valid: false,
        errorKind: 'invalid',
      })
      setIsLoadingPreview(false)
      return
    }

    setIsLoadingPreview(true)
    setActionError(null)

    try {
      const res = await previewPlaylistInvitation(token)
      if (res.valid) {
        setPreview({
          valid: true,
          status: res.status,
          playlistId: res.playlist_id,
          playlistTitle: res.playlist_title,
          inviterName: res.inviter_name,
          role: res.role,
        })
      } else {
        const kind = (res.error_kind as InvitationFailureKind) || 'invalid'
        setPreview({
          valid: false,
          errorKind: kind,
          playlistTitle: res.playlist_title,
        })
      }
    } catch {
      setPreview({
        valid: false,
        errorKind: 'network',
      })
    } finally {
      setIsLoadingPreview(false)
    }
  }, [token])

  useEffect(() => {
    void loadPreview()
  }, [loadPreview, user?.id])

  async function handleAccept() {
    if (!token || isSubmitting) return
    setActionError(null)
    setIsSubmitting(true)

    try {
      const { data, error } = await acceptPlaylistInvitation(token)

      if (error) {
        const failureKind = classifyInvitationFailure({
          message: error.message,
          code: (error as unknown as { code?: string })?.code,
        })

        if (failureKind === 'already_member') {
          const playlistId = preview?.playlistId || ''
          setSuccessInfo({
            playlistId,
            playlistTitle: preview?.playlistTitle,
            role: preview?.role || 'editor',
            isAlreadyMember: true,
          })
          notify({
            tone: 'success',
            title: 'Sudah Bergabung',
            description: 'Anda sudah menjadi kolaborator playlist ini.',
          })
          if (playlistId) {
            navigate(`/playlist/${playlistId}`)
          }
          return
        }

        setActionError({
          kind: failureKind,
          message: invitationFailureMessage(failureKind),
        })
        notify({
          tone: 'info',
          title: 'Tidak dapat bergabung',
          description: invitationFailureMessage(failureKind),
        })
        return
      }

      if (data) {
        const isAlreadyMember = data.status === 'already_member'
        setSuccessInfo({
          playlistId: data.playlist_id,
          playlistTitle: data.playlist_title || preview?.playlistTitle,
          role: data.role,
          isAlreadyMember,
        })

        notify({
          tone: 'success',
          title: isAlreadyMember ? 'Sudah Bergabung' : 'Undangan Diterima!',
          description: isAlreadyMember
            ? `Anda sudah menjadi kolaborator di playlist “${data.playlist_title || 'ini'}”.`
            : `Anda berhasil bergabung ke playlist “${data.playlist_title || 'ini'}” sebagai ${data.role}.`,
        })

        if (data.playlist_id) {
          navigate(`/playlist/${data.playlist_id}`)
        } else {
          navigate('/explore')
        }
      }
    } catch {
      setActionError({
        kind: 'network',
        message: invitationFailureMessage('network'),
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  // 1. Loading state
  if (isLoadingPreview) {
    return (
      <div className="max-w-lg mx-auto mt-6 rounded-card border border-border bg-surface/60 p-6 sm:p-8 shadow-lg text-center space-y-3">
        <Loader2 className="size-8 mx-auto animate-spin text-accent" />
        <h2 className="text-base font-semibold text-foreground">Memeriksa Tautan Undangan…</h2>
        <p className="text-xs text-muted">Memverifikasi keabsahan undangan kolaborasi ORBIM.</p>
      </div>
    )
  }

  // 2. Already joined / Success state
  const isAlreadyMember = preview?.status === 'already_member' || successInfo?.isAlreadyMember
  const targetPlaylistId = successInfo?.playlistId || preview?.playlistId
  const targetPlaylistTitle = successInfo?.playlistTitle || preview?.playlistTitle || 'Playlist'
  const targetRole = successInfo?.role || preview?.role || 'editor'

  if (successInfo || isAlreadyMember) {
    return (
      <div className="max-w-lg mx-auto mt-6 rounded-card border border-border bg-surface/60 p-5 sm:p-7 shadow-lg space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent">
            {isAlreadyMember ? (
              <UserCheck className="size-5" />
            ) : (
              <CheckCircle2 className="size-5" />
            )}
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              {isAlreadyMember ? 'Anda Sudah Bergabung' : 'Berhasil Bergabung!'}
            </h1>
            <p className="text-xs text-muted">
              {isAlreadyMember
                ? `Anda sudah terdaftar sebagai ${targetRole} di playlist ini.`
                : `Selamat bergabung sebagai ${targetRole} di playlist ini.`}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-background/50 p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-foreground font-medium text-sm">
            <Music2 className="size-4 text-accent" />
            <span>{targetPlaylistTitle}</span>
          </div>
          <p className="text-xs text-muted">
            Anda dapat mendengarkan, menambahkan, dan mengelola lagu bersama kolaborator lainnya.
          </p>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          {targetPlaylistId ? (
            <Button
              className="w-full gap-2"
              onClick={() => navigate(`/playlist/${targetPlaylistId}`)}
            >
              <ExternalLink className="size-4" />
              Buka Playlist
            </Button>
          ) : (
            <Button className="w-full" onClick={() => navigate('/explore')}>
              Jelajahi Playlist
            </Button>
          )}
          <Link
            to="/explore"
            className={buttonVariants({ variant: 'ghost', size: 'sm', className: 'w-full' })}
          >
            Kembali ke Beranda
          </Link>
        </div>
      </div>
    )
  }

  // 3. Invalid or Expired or Error State during Preview
  if (!preview?.valid) {
    const failureKind = preview?.errorKind || 'invalid'
    const errorText = invitationFailureMessage(failureKind)
    const canRetry = isRecoverableFailure(failureKind)

    return (
      <div className="max-w-lg mx-auto mt-6 rounded-card border border-border bg-surface/60 p-5 sm:p-7 shadow-lg space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-400">
            <AlertCircle className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              Undangan Tidak Tersedia
            </h1>
            <p className="text-xs text-muted">Status validasi undangan kolaborasi.</p>
          </div>
        </div>

        <div
          role="alert"
          className="rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-300 leading-relaxed"
        >
          {errorText}
        </div>

        <div className="flex flex-col gap-2 pt-2">
          {canRetry ? (
            <Button
              className="w-full gap-2"
              onClick={() => void loadPreview()}
              disabled={isLoadingPreview}
            >
              <RefreshCw className="size-4" />
              Coba Lagi
            </Button>
          ) : null}
          <Link
            to="/explore"
            className={buttonVariants({
              variant: canRetry ? 'ghost' : 'primary',
              size: 'sm',
              className: 'w-full',
            })}
          >
            Jelajahi {site.name}
          </Link>
        </div>
      </div>
    )
  }

  // 4. Valid Pending Invitation State
  const canRetryAction = actionError ? isRecoverableFailure(actionError.kind) : false

  return (
    <div className="max-w-lg mx-auto mt-6 rounded-card border border-border bg-surface/60 p-5 sm:p-7 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Undangan Kolaborasi Playlist</h1>
        <Badge tone="accent" className="py-0.5">
          Tautan Aktif
        </Badge>
      </div>

      <p className="mt-1.5 text-sm leading-relaxed text-muted">
        Anda menerima undangan untuk berkolaborasi dan mengelola lagu di playlist bersama.
      </p>

      {/* Playlist info card */}
      <div className="mt-4 rounded-xl border border-accent/30 bg-accent/10 p-4 space-y-2">
        <div className="flex items-center gap-2 text-foreground font-semibold text-base">
          <Music2 className="size-5 text-accent" />
          <span>{preview.playlistTitle || 'Playlist'}</span>
        </div>
        <div className="text-xs text-muted space-y-0.5">
          <p>
            Diundang oleh:{' '}
            <strong className="text-foreground">{preview.inviterName || 'Pemilik Playlist'}</strong>
          </p>
          <p>
            Peran akses: <strong className="text-foreground capitalize">{preview.role || 'Editor'}</strong>
          </p>
        </div>
      </div>

      {actionError ? (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400"
        >
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p className="leading-relaxed">{actionError.message}</p>
        </div>
      ) : null}

      <div className="mt-4 rounded-xl border border-border bg-elevated/40 p-3.5 text-xs text-muted space-y-2">
        <div className="flex items-center gap-2 text-foreground font-medium">
          <ShieldCheck aria-hidden="true" className="size-4 text-accent" />
          <span>Akses Kolaborasi Terverifikasi</span>
        </div>
        <p className="text-[11px] leading-relaxed">
          Tautan undangan berlaku selama 7 hari sejak dibuat. Setelah bergabung, playlist akan muncul
          di perpustakaan Anda dan Anda dapat mengelola lagu bersama.
        </p>
      </div>

      <div className="mt-5 space-y-2 border-t border-border pt-4">
        {user ? (
          <div className="space-y-2">
            <Button
              className="w-full"
              onClick={handleAccept}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Memproses…
                </>
              ) : (
                'Terima Undangan'
              )}
            </Button>
            {actionError && canRetryAction ? (
              <Button
                variant="secondary"
                className="w-full gap-2"
                onClick={handleAccept}
                disabled={isSubmitting}
              >
                <RefreshCw className="size-4" />
                Coba Lagi
              </Button>
            ) : null}
          </div>
        ) : (
          <Link
            to="/login"
            state={{ from: `/invite/${token}` }}
            className={buttonVariants({ className: 'w-full gap-2' })}
          >
            <LogIn className="size-4" />
            Masuk untuk Menerima Undangan
          </Link>
        )}
      </div>

      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link to="/explore" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          Jelajahi {site.name}
        </Link>
      </div>
    </div>
  )
}
