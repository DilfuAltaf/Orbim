import { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { ListMusic, LogIn, Plus, UserRound, Users } from 'lucide-react'

import { CreatePlaylistDialog } from '@/components/playlist/CreatePlaylistDialog'
import { Badge } from '@/components/ui/Badge'
import { Logo } from '@/components/ui/Logo'
import { useAuth } from '@/features/auth/auth-context'
import {
  MIN_LEFT_WIDTH,
  MAX_LEFT_WIDTH,
  useLayout,
} from '@/features/layout/layout-context'
import {
  primaryNavigation,
  sidebarNavLinkActiveClass,
  sidebarNavLinkClass,
  sidebarNavLinkIdleClass,
} from '@/lib/navigation'
import { getDataSource } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { fetchUserPlaylists } from '@/services/playlist/supabase-playlist'

interface SidebarPlaylist {
  id: string
  title: string
  visibility?: string
}

/** Persistent desktop sidebar. Hidden below the `lg` breakpoint. Resizable width. */
export function AppSidebar() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const {
    leftWidth,
    isDraggingLeft,
    isDesktop,
    startDraggingLeft,
    resetLeftWidth,
    setLeftWidth,
  } = useLayout()
  const isDemo = getDataSource() === 'demo'

  const [playlists, setPlaylists] = useState<SidebarPlaylist[]>([])
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  // Fetch only this user's created/member playlists
  useEffect(() => {
    if (!user) {
      setPlaylists([])
      return
    }

    let active = true

    async function loadPlaylists() {
      const { data } = await fetchUserPlaylists()
      if (active && data) {
        setPlaylists(
          data.map((p) => ({
            id: p.id,
            title: p.title,
            visibility: p.visibility,
          })),
        )
      }
    }

    void loadPlaylists()

    function handlePlaylistUpdate() {
      void loadPlaylists()
    }

    window.addEventListener('orbim:playlist-updated', handlePlaylistUpdate)
    return () => {
      active = false
      window.removeEventListener('orbim:playlist-updated', handlePlaylistUpdate)
    }
  }, [user])

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border bg-surface/40 lg:flex group/sidebar select-none"
      style={{
        width: isDesktop ? `${leftWidth}px` : undefined,
      }}
    >
      <div className="flex h-16 shrink-0 items-center px-5">
        <Link
          to="/"
          aria-label="ORBIM home"
          className="rounded-lg focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
        >
          <Logo />
        </Link>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
        <p className="px-3 pb-2 text-[10px] font-semibold tracking-[0.18em] text-muted uppercase">
          Menu
        </p>
        <ul className="space-y-0.5">
          {primaryNavigation.map((item) => {
            const Icon = item.icon

            return (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      sidebarNavLinkClass,
                      isActive ? sidebarNavLinkActiveClass : sidebarNavLinkIdleClass,
                    )
                  }
                >
                  <Icon aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={1.75} />
                  <span>{item.label}</span>
                </NavLink>
              </li>
            )
          })}
        </ul>

        {/* Playlists Section */}
        <div className="mt-6 flex items-center justify-between px-3 pb-2">
          <p className="text-[10px] font-semibold tracking-[0.18em] text-muted uppercase">
            Playlist Saya
          </p>
          {user && (
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="text-muted hover:text-accent transition-colors p-0.5 rounded focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none"
              title="Buat playlist baru"
              aria-label="Buat playlist baru"
            >
              <Plus className="size-4" />
            </button>
          )}
        </div>

        {user ? (
          playlists.length > 0 ? (
            <ul className="space-y-0.5">
              {playlists.map((pl) => (
                <li key={pl.id}>
                  <NavLink
                    to={`/playlist/${pl.id}`}
                    className={({ isActive }) =>
                      cn(
                        sidebarNavLinkClass,
                        isActive ? sidebarNavLinkActiveClass : sidebarNavLinkIdleClass,
                      )
                    }
                  >
                    {pl.visibility === 'shared' ? (
                      <Users aria-hidden="true" className="size-[18px] shrink-0 text-accent" strokeWidth={1.75} />
                    ) : (
                      <ListMusic aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={1.75} />
                    )}
                    <span className="truncate">{pl.title}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-3 py-2 text-xs text-muted">
              <p>Belum ada playlist.</p>
              <button
                type="button"
                onClick={() => setIsCreateOpen(true)}
                className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
              >
                <Plus className="size-3" />
                Buat playlist baru
              </button>
            </div>
          )
        ) : (
          <div className="px-3 py-2 text-[11px] text-muted">
            <Link to="/login" className="text-accent hover:underline font-medium">
              Masuk
            </Link>{' '}
            untuk membuat playlist kolaborasi.
          </div>
        )}
      </nav>

      <div className="border-t border-border px-4 py-3.5">
        {user ? (
          <Link
            to="/settings"
            className="flex items-center gap-3 rounded-lg p-1.5 transition-colors hover:bg-elevated/70"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
              {profile?.display_name ? (
                profile.display_name.slice(0, 2).toUpperCase()
              ) : (
                <UserRound className="size-4 text-accent" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">
                {profile?.display_name || 'Music Explorer'}
              </p>
              <p className="truncate text-[10px] text-muted">{user.email}</p>
            </div>
          </Link>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Badge tone="neutral" className="py-0.5">
                Guest session
              </Badge>
              <Link
                to="/login"
                className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
              >
                <LogIn className="size-3" />
                Sign in
              </Link>
            </div>
            <p className="text-[11px] leading-relaxed text-muted">
              {isDemo
                ? 'Jelajahi katalog musik dan dengarkan track audio berkualitas tinggi.'
                : 'Masuk dengan akun ORBIM untuk mendengarkan lagu dan streaming audio.'}
            </p>
          </div>
        )}
      </div>

      {/* Resizable handle on right edge */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Ubah ukuran sidebar kiri"
        aria-valuenow={leftWidth}
        aria-valuemin={MIN_LEFT_WIDTH}
        aria-valuemax={MAX_LEFT_WIDTH}
        tabIndex={0}
        onPointerDown={startDraggingLeft}
        onDoubleClick={resetLeftWidth}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setLeftWidth((w) => Math.min(MAX_LEFT_WIDTH, w + 12))
          if (e.key === 'ArrowLeft') setLeftWidth((w) => Math.max(MIN_LEFT_WIDTH, w - 12))
          if (e.key === 'Home') setLeftWidth(MIN_LEFT_WIDTH)
          if (e.key === 'End') setLeftWidth(MAX_LEFT_WIDTH)
        }}
        title="Tarik untuk mengubah lebar bar kiri (Klik ganda untuk reset)"
        className={cn(
          'absolute -right-1.5 top-0 bottom-0 z-50 w-3 cursor-col-resize select-none transition-all group/handle',
          'flex items-center justify-center hover:w-4',
          isDraggingLeft && 'w-4',
        )}
      >
        <div
          className={cn(
            'h-full w-[2px] transition-colors duration-150',
            isDraggingLeft ? 'bg-accent w-[3px]' : 'bg-transparent group-hover/handle:bg-accent/70',
          )}
        />
      </div>

      <CreatePlaylistDialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSuccess={(newPlaylist) => {
          navigate(`/playlist/${newPlaylist.id}`)
        }}
      />
    </aside>
  )
}
