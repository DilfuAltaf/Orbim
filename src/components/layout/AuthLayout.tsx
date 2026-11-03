import { Link, Outlet } from 'react-router-dom'

import { Logo } from '@/components/ui/Logo'
import { site } from '@/config/site'

/** Split layout for sign-in, registration and invitation screens (no app chrome). */
export function AuthLayout() {
  return (
    <div className="flex min-h-svh bg-background">
      <aside className="relative hidden w-[46%] flex-col justify-between overflow-hidden border-r border-border bg-surface/40 p-10 lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              'radial-gradient(70% 60% at 70% 25%, rgba(183,243,107,0.10) 0%, transparent 60%), radial-gradient(60% 60% at 20% 85%, rgba(167,139,250,0.12) 0%, transparent 65%)',
          }}
        />

        <Link
          to="/"
          aria-label="ORBIM home"
          className="relative w-fit rounded-lg focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
        >
          <Logo />
        </Link>

        <div className="relative">
          <div aria-hidden="true" className="relative mb-10 size-44">
            <span className="absolute inset-0 rounded-full border border-border" />
            <span className="absolute inset-6 rounded-full border border-border/80" />
            <span className="absolute inset-14 rounded-full border border-border/60" />
            <span className="absolute top-1/2 left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" />
            <span className="absolute top-3 right-6 size-2 rounded-full bg-accent-secondary" />
            <span className="absolute bottom-6 left-2 size-1.5 rounded-full bg-accent/70" />
          </div>

          <h2 className="max-w-sm text-2xl leading-snug font-semibold tracking-tight">
            {site.tagline}
          </h2>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
            A shared collection that lives outside any single streaming service. Discover
            independent music, then build the same playlist from two different cities.
          </p>
        </div>

        <p className="relative text-[11px] leading-relaxed text-muted">
          Preview interface · accounts are not connected in this build
        </p>
      </aside>

      <div className="flex min-h-svh w-full flex-col lg:w-[54%]">
        <header className="flex h-16 items-center justify-between px-5 sm:px-8 lg:hidden">
          <Link
            to="/"
            aria-label="ORBIM home"
            className="rounded-lg focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none"
          >
            <Logo />
          </Link>
          <Link
            to="/explore"
            className="rounded text-xs text-muted transition-colors hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none"
          >
            Explore first
          </Link>
        </header>

        <main id="main-content" className="flex flex-1 items-center justify-center px-4 py-8 sm:px-8">
          <div className="w-full max-w-md">
            <Outlet />
          </div>
        </main>

        <footer className="px-5 py-6 text-center text-[11px] text-muted sm:px-8">
          <Link
            to="/"
            className="rounded transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:outline-none"
          >
            Back to ORBIM
          </Link>
        </footer>
      </div>
    </div>
  )
}
