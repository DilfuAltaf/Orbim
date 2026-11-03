import { AlertCircle, CheckCircle2, Loader2, Music2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { handleSpotifyCallback, type SpotifySession } from '@/services/spotify'

type CallbackStatus =
  | { state: 'loading'; message: string }
  | { state: 'success'; session: SpotifySession }
  | { state: 'error'; message: string; code?: string }

export function SpotifyCallbackPage() {
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<CallbackStatus>({
    state: 'loading',
    message: 'Verifying Spotify authorization…',
  })
  const processedRef = useRef(false)

  useEffect(() => {
    // Avoid double processing in React StrictMode
    if (processedRef.current) return
    processedRef.current = true

    handleSpotifyCallback(searchParams)
      .then((session) => {
        setStatus({
          state: 'success',
          session,
        })
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to complete Spotify authorization. Please try again.'
        const code = (err as { code?: string })?.code
        setStatus({
          state: 'error',
          message,
          code,
        })
      })
  }, [searchParams])

  return (
    <>
      <PageHeader
        title="Spotify Authorization"
        description="Connecting your Spotify account with ORBIM."
      />

      <div className="mx-auto max-w-lg pt-6">
        <div className="rounded-card border border-border bg-surface/70 p-6 shadow-sm backdrop-blur">
          {status.state === 'loading' ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Loader2 aria-hidden="true" className="size-8 animate-spin text-accent" />
              <h2 className="mt-4 text-base font-semibold text-foreground">Authorizing with Spotify</h2>
              <p className="mt-1 text-xs text-muted">{status.message}</p>
            </div>
          ) : status.state === 'success' ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                <CheckCircle2 aria-hidden="true" className="size-6" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-foreground">Spotify Connected!</h2>
              <p className="mt-1 text-xs text-muted">
                {status.session.user?.displayName
                  ? `Logged in as ${status.session.user.displayName}.`
                  : 'Your Spotify account has been authorized successfully.'}
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Link to="/explore">
                  <Button variant="primary" size="sm">
                    <Music2 aria-hidden="true" className="size-4" />
                    Explore Music
                  </Button>
                </Link>
                <Link to="/settings">
                  <Button variant="secondary" size="sm">
                    Go to Settings
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-500">
                <AlertCircle aria-hidden="true" className="size-6" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-foreground">Authorization Failed</h2>
              <p className="mt-1 max-w-sm text-xs text-rose-300">{status.message}</p>
              {status.code === 'DEV_MODE_RESTRICTED' || status.code === 'ACCESS_DENIED' ? (
                <p className="mt-2 max-w-sm rounded bg-elevated/80 p-2 text-[11px] text-muted">
                  Notice: Spotify apps in Development Mode allow up to 5 authorized users added in
                  the Developer Dashboard User Management list.
                </p>
              ) : null}
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Link to="/settings">
                  <Button variant="primary" size="sm">
                    Back to Settings
                  </Button>
                </Link>
                <Link to="/explore">
                  <Button variant="secondary" size="sm">
                    Go to Explore
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
