import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  evaluateAuthGuard,
  isRouteProtected,
  PROTECTED_ROUTES,
} from '../src/features/auth/auth-policy.ts'

describe('Auth Guard & Route Authorization Policy', () => {
  const dummySession = {
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'user@example.com',
    },
    access_token: 'valid.token',
  }

  describe('Route Classification (Public vs Private)', () => {
    it('identifies all four private routes as protected', () => {
      for (const route of PROTECTED_ROUTES) {
        assert.equal(
          isRouteProtected(route),
          true,
          `Route ${route} should be recognized as protected`,
        )
      }
    })

    it('identifies sub-paths of protected routes as protected', () => {
      assert.equal(isRouteProtected('/library/new'), true)
      assert.equal(isRouteProtected('/settings/profile'), true)
      assert.equal(isRouteProtected('/import/batch'), true)
      assert.equal(isRouteProtected('/shared/collaborations'), true)
    })

    it('identifies public discovery routes as not protected', () => {
      assert.equal(isRouteProtected('/'), false)
      assert.equal(isRouteProtected('/explore'), false)
      assert.equal(isRouteProtected('/playlist/123'), false)
      assert.equal(isRouteProtected('/login'), false)
      assert.equal(isRouteProtected('/register'), false)
      assert.equal(isRouteProtected('/invite/token123'), false)
    })

    it('verifies explicit list of protected routes matches PRD requirements', () => {
      assert.deepEqual(
        [...PROTECTED_ROUTES].sort(),
        ['/import', '/library', '/settings', '/shared'],
        'Protected routes must include /library, /import, /shared, and /settings',
      )
    })
  })

  describe('Session Loading State (Prevent False Unauthenticated Redirects)', () => {
    it('holds in loading status when session is initializing, even if session is currently null', () => {
      const decision = evaluateAuthGuard({
        session: null,
        isLoading: true,
        isDemo: false,
        pathname: '/library',
      })

      assert.equal(
        decision.status,
        'loading',
        'Should report loading status while session resolution is in flight',
      )
      assert.equal(
        'redirectTo' in decision,
        false,
        'Must NOT issue a redirect while session is loading',
      )
    })

    it('holds in loading status when session is initializing, even in demo mode', () => {
      const decision = evaluateAuthGuard({
        session: null,
        isLoading: true,
        isDemo: true,
        pathname: '/settings',
      })

      assert.equal(decision.status, 'loading')
    })
  })

  describe('Supabase Mode (Strict Private Route Protection)', () => {
    it('denies guest access to /library in Supabase mode and redirects to /login', () => {
      const decision = evaluateAuthGuard({
        session: null,
        isLoading: false,
        isDemo: false,
        pathname: '/library',
      })

      assert.equal(decision.status, 'unauthorized')
      if (decision.status === 'unauthorized') {
        assert.equal(decision.redirectTo, '/library')
      }
    })

    it('denies guest access to /import in Supabase mode with destination preserved', () => {
      const decision = evaluateAuthGuard({
        session: null,
        isLoading: false,
        isDemo: false,
        pathname: '/import',
      })

      assert.equal(decision.status, 'unauthorized')
      if (decision.status === 'unauthorized') {
        assert.equal(decision.redirectTo, '/import')
      }
    })

    it('denies guest access to /shared in Supabase mode with destination preserved', () => {
      const decision = evaluateAuthGuard({
        session: null,
        isLoading: false,
        isDemo: false,
        pathname: '/shared',
      })

      assert.equal(decision.status, 'unauthorized')
      if (decision.status === 'unauthorized') {
        assert.equal(decision.redirectTo, '/shared')
      }
    })

    it('denies guest access to /settings in Supabase mode with destination preserved', () => {
      const decision = evaluateAuthGuard({
        session: null,
        isLoading: false,
        isDemo: false,
        pathname: '/settings',
      })

      assert.equal(decision.status, 'unauthorized')
      if (decision.status === 'unauthorized') {
        assert.equal(decision.redirectTo, '/settings')
      }
    })

    it('authorizes authenticated user on protected routes in Supabase mode', () => {
      for (const route of PROTECTED_ROUTES) {
        const decision = evaluateAuthGuard({
          session: dummySession,
          isLoading: false,
          isDemo: false,
          pathname: route,
        })

        assert.equal(
          decision.status,
          'authorized',
          `Authenticated user should be authorized on ${route}`,
        )
        if (decision.status === 'authorized') {
          assert.equal(decision.reason, 'authenticated')
        }
      }
    })
  })

  describe('Demo Mode (Development & Preview Behavior)', () => {
    it('permits unauthenticated preview access on protected routes in demo mode', () => {
      for (const route of PROTECTED_ROUTES) {
        const decision = evaluateAuthGuard({
          session: null,
          isLoading: false,
          isDemo: true,
          pathname: route,
        })

        assert.equal(
          decision.status,
          'authorized',
          `Demo mode should allow preview on ${route}`,
        )
        if (decision.status === 'authorized') {
          assert.equal(decision.reason, 'demo_preview')
        }
      }
    })

    it('attributes authenticated session priority over demo_preview when user is logged in in demo mode', () => {
      const decision = evaluateAuthGuard({
        session: dummySession,
        isLoading: false,
        isDemo: true,
        pathname: '/library',
      })

      assert.equal(decision.status, 'authorized')
      if (decision.status === 'authorized') {
        assert.equal(
          decision.reason,
          'authenticated',
          'Logged-in session takes precedence over demo_preview reason',
        )
      }
    })
  })

  describe('Post-Login Redirection Destination Preservation', () => {
    it('preserves deeply nested sub-paths for redirection state', () => {
      const targetPath = '/library?filter=owned#top'
      const decision = evaluateAuthGuard({
        session: null,
        isLoading: false,
        isDemo: false,
        pathname: targetPath,
      })

      assert.equal(decision.status, 'unauthorized')
      if (decision.status === 'unauthorized') {
        assert.equal(decision.redirectTo, targetPath)
      }
    })
  })
})
