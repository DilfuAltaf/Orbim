import { useEffect, useState } from 'react'
import { Link, Outlet } from 'react-router-dom'

import { AppSidebar } from '@/components/layout/AppSidebar'
import { MobileNavigation } from '@/components/layout/MobileNavigation'
import { LyricsPanel } from '@/components/music/LyricsPanel'
import { MusicPlayer } from '@/components/music/MusicPlayer'
import { Badge } from '@/components/ui/Badge'
import { Logo } from '@/components/ui/Logo'
import { site } from '@/config/site'
import { useLayout } from '@/features/layout/layout-context'
import {
  CLOSE_LYRICS_EVENT,
  OPEN_LYRICS_EVENT,
  persistLyricsPanelOpen,
  readLyricsPanelOpen,
} from '@/features/lyrics/lyrics-panel-state'
import { getDataSource } from '@/lib/supabase'

/**
 * Shared application shell: resizable sidebar on desktop, compact header and bottom tab
 * bar on mobile, with the player docked above the tab bar so transport controls stay
 * reachable at every breakpoint.
 */
export function AppShell() {
  const isDemo = getDataSource() === 'demo'
  const [isLyricsOpen, setIsLyricsOpen] = useState(() => readLyricsPanelOpen())
  const { leftWidth, rightWidth, isDesktop } = useLayout()

  // The player transport and this shell share the panel through the existing
  // window events, so the layout never depends on a second source of truth.
  useEffect(() => {
    const open = () => {
      setIsLyricsOpen(true)
      persistLyricsPanelOpen(true)
    }
    const close = () => {
      setIsLyricsOpen(false)
      persistLyricsPanelOpen(false)
    }

    window.addEventListener(OPEN_LYRICS_EVENT, open)
    window.addEventListener(CLOSE_LYRICS_EVENT, close)
    return () => {
      window.removeEventListener(OPEN_LYRICS_EVENT, open)
      window.removeEventListener(CLOSE_LYRICS_EVENT, close)
    }
  }, [])

  function closeLyrics() {
    setIsLyricsOpen(false)
    persistLyricsPanelOpen(false)
    window.dispatchEvent(new CustomEvent(CLOSE_LYRICS_EVENT))
  }

  return (
    <div className="min-h-svh bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-contrast"
      >
        Skip to content
      </a>

      <AppSidebar />

      <div
        className="flex min-h-svh flex-col transition-[padding] duration-75"
        style={{
          paddingLeft: isDesktop ? `${leftWidth}px` : undefined,
          paddingRight: isDesktop && isLyricsOpen ? `${rightWidth}px` : undefined,
        }}
      >
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 backdrop-blur sm:px-6 lg:px-10">
          <div className="flex items-center gap-3">
            <div className="lg:hidden">
              <Link
                to="/"
                aria-label="ORBIM home"
                className="rounded-lg focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none"
              >
                <Logo />
              </Link>
            </div>
            <div className="hidden lg:flex items-center gap-2 text-xs text-muted">
              <span className="font-semibold text-foreground tracking-tight">{site.name}</span>
              <span className="text-border">/</span>
              <span>{site.tagline}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Badge tone={isDemo ? 'accent' : 'violet'} className="py-0.5">
              {isDemo ? 'Demo' : 'Live'}
            </Badge>
          </div>
        </header>

        <main id="main-content" className="flex-1 pb-36 lg:pb-24">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
            <Outlet />
          </div>
        </main>

        {/* Extra bottom padding keeps the footer above the fixed player at full scroll. */}
        <footer className="hidden border-t border-border px-6 py-3 text-[11px] text-muted lg:block lg:px-10 lg:pb-[4.75rem]">
          <span className="text-foreground/70">
            {site.name} — {site.tagline}
          </span>
          <span className="mx-2 text-border">/</span>
          <span>
            {isDemo
              ? 'Demo build. No account, storage or audio provider is connected.'
              : 'Live build. Supabase playlists and Spotify catalog via PKCE — no client secret in the browser.'}
          </span>
        </footer>
      </div>

      <MusicPlayer />
      {isLyricsOpen ? <LyricsPanel onClose={closeLyrics} /> : null}
      <MobileNavigation />
    </div>
  )
}
