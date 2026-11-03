/**
 * Auth Guard and Route Authorization Policy.
 *
 * Provides pure, testable decision logic for application route protection.
 * Client-side route guards improve user experience by preventing unauthorized page flashes
 * and redirecting unauthenticated users to /login.
 *
 * SECURITY NOTE:
 * Client-side guards are an interface convenience, NOT a security boundary.
 * Authoritative security and data isolation are strictly enforced by PostgreSQL
 * Row Level Security (RLS) policies and Supabase Storage access rules.
 */

export const PROTECTED_ROUTES = [
  '/library',
  '/import',
  '/shared',
  '/settings',
] as const

export const PUBLIC_ROUTES = [
  '/',
  '/explore',
  '/login',
  '/register',
  '/invite',
] as const

export type AuthGuardDecision =
  | { status: 'loading' }
  | { status: 'authorized'; reason: 'authenticated' | 'demo_preview' }
  | { status: 'unauthorized'; redirectTo: string }

export interface EvaluateAuthGuardParams {
  session: unknown | null
  isLoading: boolean
  isDemo: boolean
  pathname: string
}

/**
 * Pure evaluation function for protected route access.
 *
 * Rules:
 * 1. While auth state is loading (`isLoading: true`), hold in 'loading' state.
 *    Never treat a loading session as a confirmed guest/logout.
 * 2. If a valid user session is present, allow access ('authorized', reason: 'authenticated').
 * 3. In demo mode (`isDemo: true`), allow previewing for development and offline exploration.
 * 4. In Supabase mode (`isDemo: false`) without a session, reject access ('unauthorized')
 *    and specify the target pathname for post-login redirection.
 */
export function evaluateAuthGuard({
  session,
  isLoading,
  isDemo,
  pathname,
}: EvaluateAuthGuardParams): AuthGuardDecision {
  if (isLoading) {
    return { status: 'loading' }
  }

  if (session) {
    return { status: 'authorized', reason: 'authenticated' }
  }

  if (isDemo) {
    return { status: 'authorized', reason: 'demo_preview' }
  }

  return { status: 'unauthorized', redirectTo: pathname }
}

/**
 * Checks whether a given path is considered a protected route.
 */
export function isRouteProtected(pathname: string): boolean {
  const normalized = pathname.trim().toLowerCase()
  return PROTECTED_ROUTES.some(
    (route) => normalized === route || normalized.startsWith(`${route}/`),
  )
}
