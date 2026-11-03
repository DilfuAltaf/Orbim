import { Bell, Check, ExternalLink, Trash2, UserMinus, UserPlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/features/auth/auth-context'
import { useToast } from '@/features/feedback/toast-context'
import { formatRelativeTime } from '@/lib/format'
import {
  deleteNotification,
  fetchUserNotifications,
  respondToInvitationNotification,
  type AppNotification,
} from '@/services/notification/notification-service'

export function NotificationBell() {
  const { user } = useAuth()
  const { notify } = useToast()
  const navigate = useNavigate()

  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isProcessing, setIsProcessing] = useState<string | null>(null)
  const [alignRight, setAlignRight] = useState(true)
  const menuRef = useRef<HTMLDivElement>(null)

  const userIdentifier = {
    userId: user?.id,
    email: user?.email,
    displayName:
      (user as unknown as { displayName?: string })?.displayName ||
      user?.user_metadata?.display_name ||
      user?.email?.split('@')[0],
  }

  useEffect(() => {
    let active = true

    async function load() {
      const list = await fetchUserNotifications(userIdentifier)
      if (active) {
        setNotifications(list)
      }
    }

    void load()

    const handleUpdate = () => {
      void load()
    }

    window.addEventListener('orbim:notifications-updated', handleUpdate)
    const timer = setInterval(() => {
      void load()
    }, 5000)

    return () => {
      active = false
      window.removeEventListener('orbim:notifications-updated', handleUpdate)
      clearInterval(timer)
    }
  }, [user?.id, user?.email, (user as unknown as { displayName?: string })?.displayName, user?.user_metadata?.display_name])

  // Determine smart alignment on toggle to prevent screen edge collisions
  function handleToggleOpen() {
    if (!isOpen && menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect()
      // If element is in the left 280px of viewport, align left so dropdown expands rightwards
      setAlignRight(rect.left > 280)
    }
    setIsOpen((prev) => !prev)
  }

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Removed-from-playlist notices stay visible until dismissed, so they count
  // toward the unread badge too.
  const pendingCount = notifications.filter(
    (n) => n.status === 'pending' || n.type === 'playlist_removed',
  ).length

  async function handleAction(notification: AppNotification, action: 'accept' | 'reject') {
    setIsProcessing(notification.id)
    const res = await respondToInvitationNotification(notification, action)
    setIsProcessing(null)

    if (action === 'accept') {
      notify({
        tone: 'success',
        title: 'Undangan Diterima!',
        description: `Anda sekarang berkolaborasi di playlist “${notification.playlistTitle}”.`,
      })
      if (res.playlistId) {
        setIsOpen(false)
        navigate(`/playlist/${res.playlistId}`)
      }
    } else {
      notify({
        tone: 'info',
        title: 'Undangan Ditolak',
        description: `Anda menolak undangan kolaborasi untuk “${notification.playlistTitle}”.`,
      })
    }
  }

  async function handleDelete(notificationId: string) {
    await deleteNotification(notificationId)
  }

  return (
    <div className="relative inline-block" ref={menuRef}>
      <button
        type="button"
        onClick={handleToggleOpen}
        aria-label={`Notifikasi (${pendingCount} belum dibaca)`}
        aria-expanded={isOpen}
        className="relative flex size-9 items-center justify-center rounded-lg border border-border bg-surface/80 text-muted transition-colors hover:border-accent/40 hover:bg-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 cursor-pointer"
      >
        <Bell className="size-4" strokeWidth={1.75} />
        {pendingCount > 0 && (
          <span className="absolute -top-1 -right-1 flex min-w-4.5 h-4.5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-contrast shadow-sm animate-pulse">
            {pendingCount > 9 ? '9+' : pendingCount}
          </span>
        )}
      </button>

      {/* Mobile backdrop */}
      {isOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs sm:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {isOpen && (
        <div
          className={`fixed inset-x-3 top-16 z-50 rounded-2xl border border-border bg-elevated/95 p-0 shadow-2xl backdrop-blur-md sm:absolute sm:inset-auto sm:top-full sm:mt-2 sm:w-96 ${
            alignRight ? 'sm:right-0 sm:left-auto' : 'sm:left-0 sm:right-auto'
          }`}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/80 px-4 py-3 bg-surface/60 rounded-t-2xl">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground text-sm tracking-tight">Notifikasi</span>
              {pendingCount > 0 ? (
                <Badge tone="accent" className="py-0.2 text-[10px]">
                  {pendingCount} Baru
                </Badge>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-muted hover:text-foreground p-1 rounded-md transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* List */}
          <div className="max-h-85 overflow-y-auto p-3 space-y-2.5">
            {notifications.length === 0 ? (
              <div className="py-10 text-center text-muted">
                <Bell className="size-7 mx-auto mb-2 opacity-30" />
                <p className="text-xs">Belum ada notifikasi.</p>
              </div>
            ) : (
              notifications.map((notif) => {
                const isItemProcessing = isProcessing === notif.id
                const isRemoval = notif.type === 'playlist_removed'

                return (
                  <div
                    key={notif.id}
                    className={`rounded-xl border p-3.5 transition-colors ${
                      notif.status === 'pending'
                        ? 'border-accent/40 bg-accent/8'
                        : 'border-border/60 bg-surface/50'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`size-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 font-semibold ${
                          isRemoval ? 'bg-border/40 text-muted' : 'bg-accent/20 text-accent'
                        }`}
                      >
                        {isRemoval ? <UserMinus className="size-4" /> : <UserPlus className="size-4" />}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs text-foreground leading-relaxed">
                            <strong className="font-semibold text-foreground">
                              {notif.senderDisplayName}
                            </strong>{' '}
                            {isRemoval
                              ? 'mengeluarkan Anda dari playlist'
                              : 'mengundang Anda untuk bergabung di playlist'}{' '}
                            <strong className="font-semibold text-accent">
                              “{notif.playlistTitle}”
                            </strong>
                            .
                          </p>
                          <button
                            type="button"
                            onClick={() => handleDelete(notif.id)}
                            title="Hapus notifikasi"
                            className="text-muted hover:text-red-400 p-1 shrink-0 rounded transition-colors cursor-pointer"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>

                        <div className="text-[10px] text-muted">
                          {formatRelativeTime(notif.createdAt)}
                        </div>

                        {/* Action buttons or status */}
                        <div className="pt-2">
                          {isRemoval ? (
                            <Badge tone="neutral" className="py-0.5 text-[10px]">
                              Dikeluarkan dari Playlist
                            </Badge>
                          ) : notif.status === 'pending' ? (
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                onClick={() => handleAction(notif, 'accept')}
                                disabled={isItemProcessing}
                                className="h-8 text-xs px-3.5 gap-1.5 bg-accent hover:bg-accent/90 text-accent-contrast font-semibold shadow-sm"
                              >
                                <Check className="size-3.5" strokeWidth={2.5} />
                                {isItemProcessing ? 'Memproses…' : 'Terima'}
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => handleAction(notif, 'reject')}
                                disabled={isItemProcessing}
                                className="h-8 text-xs px-3.5 gap-1.5 text-muted hover:text-foreground"
                              >
                                <X className="size-3.5" />
                                Tolak
                              </Button>
                            </div>
                          ) : notif.status === 'accepted' ? (
                            <div className="flex items-center justify-between gap-2">
                              <Badge tone="accent" className="py-0.5 text-[10px]">
                                Undangan Diterima
                              </Badge>
                              <Link
                                to={`/playlist/${notif.playlistId}`}
                                onClick={() => setIsOpen(false)}
                                className="flex items-center gap-1 text-[11px] text-accent hover:underline font-semibold"
                              >
                                Buka Playlist
                                <ExternalLink className="size-3" />
                              </Link>
                            </div>
                          ) : (
                            <Badge tone="neutral" className="py-0.5 text-[10px]">
                              Undangan Ditolak
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
