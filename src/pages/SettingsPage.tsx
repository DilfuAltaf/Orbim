import { Info, Lock, LogOut, Music, SlidersHorizontal, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { site } from '@/config/site'
import { mockPlaylists, mockTracks } from '@/data/mock'
import { useAuth } from '@/features/auth/auth-context'
import { useToast } from '@/features/feedback/toast-context'
import { buttonVariants } from '@/lib/styles'
import { getDataSource } from '@/lib/supabase'
import { getMusicProvider } from '@/services/music'
import {
  getSpotifySession,
  SPOTIFY_SESSION_CHANGE_EVENT,
} from '@/services/spotify'

function buildPreferences(isDemo: boolean) {
  return [
    {
      label: 'Default playlist visibility',
      value: 'Private',
      note: 'New playlists start private until you invite someone.',
      phase: 'Working',
    },
    {
      label: 'Autoplay next track',
      value: isDemo ? 'Simulated in demo player' : 'Playable tracks only',
      note: isDemo
        ? 'The demo queue advances on a timer because no audio is streamed.'
        : 'Only tracks with a real audio source advance automatically; metadata-only tracks stay paused.',
      phase: isDemo ? 'Demo' : 'Live',
    },
    {
      label: 'Motion',
      value: 'Follow system setting',
      note: 'Animations are disabled automatically when reduced motion is requested.',
      phase: 'Working',
    },
    {
      label: 'Search debounce',
      value: '220 ms',
      note: 'Keeps catalog searches responsive and reduces Spotify Web API requests.',
      phase: 'Working',
    },
  ]
}

function buildPrivacyRows(params: {
  isDemo: boolean
  isConfigured: boolean
  isSpotifyConnected: boolean
}) {
  const { isDemo, isConfigured, isSpotifyConnected } = params

  return [
    {
      label: 'Account data',
      value: isConfigured ? 'Supabase Auth' : 'Not configured',
      note: isConfigured
        ? 'Email and profile are held in your Supabase project. ORBIM keeps no separate credential store.'
        : 'Supabase configuration is missing, so no account data can be stored.',
      phase: isConfigured ? 'Live' : 'Demo',
    },
    {
      label: 'Playlist storage',
      value: isConfigured ? 'PostgreSQL + RLS' : 'Not connected',
      note: isConfigured
        ? 'Playlists and tracks are database rows protected by PostgreSQL Row Level Security.'
        : isDemo
          ? 'Demo fixtures are served because demo mode is explicitly enabled.'
          : 'No playlist backend is reachable right now; the UI reports the failure instead of inventing rows.',
      phase: isConfigured ? 'Live' : 'Demo',
    },
    {
      label: 'Spotify authorization',
      value: isSpotifyConnected ? 'PKCE session active' : 'Not connected',
      note: isSpotifyConnected
        ? 'Access and refresh tokens stay in this browser only and are never sent to Supabase. Disconnect at any time.'
        : 'Only the public Client ID is used in the browser. ORBIM never requests or stores a client secret.',
      phase: 'Live',
    },
    {
      label: 'Invitations',
      value: isConfigured ? '7-day hashed tokens' : 'Disabled',
      note: isConfigured
        ? 'Invitation tokens are hashed, single-use and expire after seven days.'
        : 'Invitations require Supabase authentication.',
      phase: isConfigured ? 'Live' : 'Demo',
    },
  ]
}

export function SettingsPage() {
  const { user, profile, signOut, isConfigured } = useAuth()
  const { notify } = useToast()
  const [spotifySession, setSpotifySession] = useState(() => getSpotifySession())

  useEffect(() => {
    const handleSessionChange = () => {
      setSpotifySession(getSpotifySession())
    }

    if (typeof window !== 'undefined') {
      window.addEventListener(SPOTIFY_SESSION_CHANGE_EVENT, handleSessionChange)
      window.addEventListener('storage', handleSessionChange)
      return () => {
        window.removeEventListener(SPOTIFY_SESSION_CHANGE_EVENT, handleSessionChange)
        window.removeEventListener('storage', handleSessionChange)
      }
    }
  }, [])

  const isDemo = getDataSource() === 'demo'
  const preferences = buildPreferences(isDemo)
  const privacyRows = buildPrivacyRows({
    isDemo,
    isConfigured,
    isSpotifyConnected: spotifySession !== null,
  })

  async function handleSignOut() {
    await signOut()
    notify({
      tone: 'info',
      title: 'Signed out',
      description: 'You have been signed out of your account.',
    })
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Account, playback and privacy preferences."
      />

      <div className="space-y-5">
        <section
          aria-labelledby="account-heading"
          className="rounded-card border border-border bg-surface/60 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full border border-dashed border-border bg-elevated text-accent font-semibold text-base">
              {profile?.display_name ? (
                profile.display_name.slice(0, 2).toUpperCase()
              ) : (
                <UserRound aria-hidden="true" className="size-6 text-muted" strokeWidth={1.5} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="account-heading" className="text-base font-semibold">
                  {user ? profile?.display_name || 'Music Explorer' : 'Guest preview'}
                </h2>
                <Badge
                  tone={user ? 'accent' : isConfigured ? 'violet' : 'neutral'}
                  className="py-0.5"
                >
                  {user ? 'Signed in' : 'Guest'}
                </Badge>
              </div>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
                {user ? (
                  <>
                    Email: <span className="font-medium text-foreground">{user.email}</span> ·
                    User ID: <span className="font-mono text-[11px] text-muted">{user.id}</span>
                  </>
                ) : (
                  'No user is signed in. Sign in or create an account to save personal playlists and collaborate on shared ones.'
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {user ? (
                <Button variant="secondary" size="sm" onClick={handleSignOut}>
                  <LogOut aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
                  Sign out
                </Button>
              ) : (
                <>
                  <Link to="/login" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                    Sign in
                  </Link>
                  <Link to="/register" className={buttonVariants({ size: 'sm' })}>
                    Create account
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>

        <section
          aria-labelledby="spotify-heading"
          className="rounded-card border border-border bg-surface/60 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              <Music aria-hidden="true" className="size-6" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="spotify-heading" className="text-base font-semibold">
                  Spotify Metadata Provider
                </h2>
                <Badge tone="accent" className="py-0.5">
                  Server API Active
                </Badge>
              </div>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
                Spotify Web API digunakan khusus untuk mencari katalog dan mengambil metadata lagu (judul, artis, album, cover art, dan durasi). Pengguna tidak perlu menghubungkan akun Spotify pribadi atau memiliki Spotify Premium. Semua audio diputar 100% dari file audio milikmu di Supabase Storage.
              </p>
              <p className="mt-1 text-[11px] text-muted">
                Pencarian metadata berjalan secara otomatis di sisi server menggunakan Spotify Client Credentials.
              </p>
            </div>
          </div>
        </section>

        <section
          aria-labelledby="preferences-heading"
          className="overflow-hidden rounded-card border border-border bg-surface/50"
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
            <SlidersHorizontal
              aria-hidden="true"
              className="size-4 text-accent"
              strokeWidth={1.75}
            />
            <h2 id="preferences-heading" className="text-sm font-semibold">
              Preferences
            </h2>
          </div>
          <ul className="divide-y divide-border/70">
            {preferences.map((preference) => (
              <li
                key={preference.label}
                className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5 px-4 py-3.5 sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{preference.label}</p>
                  <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-muted">
                    {preference.note}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted">{preference.value}</span>
                  <Badge
                    tone={preference.phase === 'Demo' ? 'violet' : 'accent'}
                    className="py-0.5"
                  >
                    {preference.phase}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="privacy-heading"
          className="overflow-hidden rounded-card border border-border bg-surface/50"
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
            <Lock aria-hidden="true" className="size-4 text-accent-secondary" strokeWidth={1.75} />
            <h2 id="privacy-heading" className="text-sm font-semibold">
              Data & privacy
            </h2>
          </div>
          <ul className="divide-y divide-border/70">
            {privacyRows.map((row) => (
              <li key={row.label} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5 px-4 py-3.5 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{row.label}</p>
                  <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-muted">
                    {row.note}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted">{row.value}</span>
                  <Badge className="py-0.5">{row.phase}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="about-heading"
          className="rounded-card border border-border bg-surface/50 p-4 sm:p-5"
        >
          <div className="flex items-center gap-2">
            <Info aria-hidden="true" className="size-4 text-muted" strokeWidth={1.75} />
            <h2 id="about-heading" className="text-sm font-semibold">
              About this build
            </h2>
            <Badge tone={isDemo ? 'violet' : 'accent'} className="py-0.5">
              {isDemo ? 'Demo mode' : 'Live mode'}
            </Badge>
          </div>

          <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
            <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5">
              <dt className="text-muted">Product</dt>
              <dd className="text-right text-foreground">
                {site.name} — {site.tagline}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5">
              <dt className="text-muted">Stack</dt>
              <dd className="text-right text-foreground">
                React 19, Vite, TypeScript, Tailwind CSS v4
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5">
              <dt className="text-muted">Catalog</dt>
              <dd className="text-right text-foreground">
                {isDemo
                  ? `${mockTracks.length} demo tracks · ${mockPlaylists.length} playlists`
                  : 'Supabase (saved playlist tracks)'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5">
              <dt className="text-muted">Music source</dt>
              <dd className="text-right text-foreground">
                {isDemo ? getMusicProvider('demo').name : 'Spotify Web API (discovery)'}
              </dd>
            </div>
          </dl>

          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            {isDemo
              ? 'Mode demo eksplisit: katalog dan playlist berasal dari fixture lokal, bukan dari database.'
              : 'Explore mencari katalog global lewat Spotify Web API. Trek yang kamu simpan tetap metadata di Supabase — audio Spotify tidak pernah diunduh atau disalin.'}
          </p>
        </section>
      </div>
    </>
  )
}
