import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '@/features/auth/auth-context'
import { evaluateAuthGuard } from '@/features/auth/auth-policy'
import { getDataSource } from '@/lib/supabase'

/**
 * Route-guard for protected application views.
 *
 * When session is loading, displays a loading spinner to prevent false unauthenticated redirects.
 * When session resolves without an authenticated user in Supabase mode, redirects to /login
 * while preserving the intended target URL in navigation state.
 * In demo mode (VITE_DATA_SOURCE=demo), permits preview access for development.
 */
export function AuthGuard() {
  const { session, isLoading } = useAuth()
  const location = useLocation()
  const isDemo = getDataSource() === 'demo'

  const decision = evaluateAuthGuard({
    session,
    isLoading,
    isDemo,
    pathname: location.pathname,
  })

  if (decision.status === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div
          aria-label="Loading session"
          className="size-6 animate-spin rounded-full border-2 border-accent border-t-transparent"
        />
      </div>
    )
  }

  if (decision.status === 'unauthorized') {
    return <Navigate to="/login" replace state={{ from: decision.redirectTo }} />
  }

  return <Outlet />
}
