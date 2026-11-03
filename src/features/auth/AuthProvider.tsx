import { useEffect, useState, useCallback, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { getDataSource, isSupabaseConfigured, supabase } from '@/lib/supabase'
import {
  getActiveLocalUser,
  setActiveLocalUser,
  saveLocalUser,
  findLocalUserByEmail,
  type LocalUser,
} from '@/services/auth/local-auth-store'
import { isUserAdmin } from './admin'
import { AuthContext, type AuthContextValue, type Profile } from './auth-context'

function createMockSupabaseUser(localUser: LocalUser): User {
  return {
    id: localUser.id,
    app_metadata: { provider: 'email' },
    user_metadata: {
      display_name: localUser.displayName,
      full_name: localUser.displayName,
    },
    aud: 'authenticated',
    confirmation_sent_at: localUser.createdAt,
    email: localUser.email,
    created_at: localUser.createdAt,
    updated_at: localUser.createdAt,
    role: 'authenticated',
  } as User
}

function createMockProfile(localUser: LocalUser): Profile {
  return {
    id: localUser.id,
    display_name: localUser.displayName,
    avatar_url: null,
    location: null,
    created_at: localUser.createdAt,
    updated_at: localUser.createdAt,
  }
}

function createMockSession(user: User): Session {
  return {
    access_token: 'orbim-local-access-token-' + user.id,
    refresh_token: 'orbim-local-refresh-token-' + user.id,
    expires_in: 3600 * 24 * 365,
    expires_at: Math.floor(Date.now() / 1000) + 3600 * 24 * 365,
    token_type: 'bearer',
    user,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured()
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(() => configured)

  const fetchProfile = useCallback(
    async (userId: string) => {
      if (!configured) return null
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle()

        if (error) {
          console.warn('Failed to fetch profile:', error.message)
          return null
        }
        return data
      } catch (err) {
        console.warn('Unexpected error fetching profile:', err)
        return null
      }
    },
    [configured],
  )

  const refreshProfile = useCallback(async () => {
    if (user) {
      if (configured) {
        const p = await fetchProfile(user.id)
        if (p) {
          setProfile(p)
          return
        }
      }
      const local = getActiveLocalUser()
      if (local) {
        setProfile(createMockProfile(local))
      }
    }
  }, [user, configured, fetchProfile])

  useEffect(() => {
    if (!configured) {
      const localUser = getActiveLocalUser()
      if (localUser) {
        const mockUser = createMockSupabaseUser(localUser)
        setSession(createMockSession(mockUser))
        setUser(mockUser)
        setProfile(createMockProfile(localUser))
      }
      return
    }

    let isMounted = true

    // Initial session load
    supabase.auth
      .getSession()
      .then(async ({ data: { session: initialSession }, error }) => {
        if (!isMounted) return
        if (error || !initialSession) {
          const localUser = getActiveLocalUser()
          if (localUser) {
            const mockUser = createMockSupabaseUser(localUser)
            setSession(createMockSession(mockUser))
            setUser(mockUser)
            setProfile(createMockProfile(localUser))
          } else {
            setSession(null)
            setUser(null)
            setProfile(null)
          }
          setIsLoading(false)
          return
        }

        setActiveLocalUser(null)
        setSession(initialSession)
        setUser(initialSession?.user ?? null)

        if (initialSession?.user) {
          const userProfile = await fetchProfile(initialSession.user.id)
          if (isMounted) setProfile(userProfile)
        }

        if (isMounted) setIsLoading(false)
      })
      .catch((err) => {
        if (!isMounted) return
        console.warn('Failed to get initial session:', err)
        const localUser = getActiveLocalUser()
        if (localUser) {
          const mockUser = createMockSupabaseUser(localUser)
          setSession(createMockSession(mockUser))
          setUser(mockUser)
          setProfile(createMockProfile(localUser))
        }
        setIsLoading(false)
      })

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!isMounted) return

      if (newSession) {
        setActiveLocalUser(null)
        setSession(newSession)
        setUser(newSession?.user ?? null)

        if (newSession?.user) {
          const userProfile = await fetchProfile(newSession.user.id)
          if (isMounted) setProfile(userProfile)
        } else {
          setProfile(null)
        }
        setIsLoading(false)
      } else if (event === 'SIGNED_OUT') {
        const localUser = getActiveLocalUser()
        if (!localUser) {
          setSession(null)
          setUser(null)
          setProfile(null)
        }
        setIsLoading(false)
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [configured, fetchProfile])

  const signIn = useCallback(
    async (email: string, password: string) => {
      const cleanEmail = email.trim()
      if (!cleanEmail || !cleanEmail.includes('@')) {
        return { error: new Error('Please enter a valid email address containing @.') }
      }
      if (!password) {
        return { error: new Error('Please enter your password.') }
      }

      // 1. Sign in against the real Supabase project in live mode. Never
      // impersonate a Supabase account with a local mock identity: the
      // collaborative invitation system requires real authenticated sessions.
      if (configured && getDataSource() !== 'demo') {
        try {
          const { data, error } = await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
          })

          if (!error && data.session && data.user) {
            setActiveLocalUser(null)
            setSession(data.session)
            setUser(data.user)

            const userProfile = await fetchProfile(data.user.id)
            setProfile(userProfile)

            return { error: null }
          }

          return { error: error && error.message ? new Error(error.message) : new Error('Sign-in failed.') }
        } catch (err) {
          return {
            error: err instanceof Error ? err : new Error(String(err)),
          }
        }
      }

      // 2. Only demo mode (or when Supabase is not configured) continues with
      // the seamless local identity.
      const localUser: LocalUser = findLocalUserByEmail(cleanEmail) || {
        id: crypto.randomUUID(),
        email: cleanEmail,
        displayName: cleanEmail.split('@')[0],
        password,
        createdAt: new Date().toISOString(),
      }

      saveLocalUser(localUser)
      setActiveLocalUser(localUser)

      const mockUser = createMockSupabaseUser(localUser)
      const mockProfile = createMockProfile(localUser)
      const mockSession = createMockSession(mockUser)

      setSession(mockSession)
      setUser(mockUser)
      setProfile(mockProfile)

      return { error: null }
    },
    [configured, fetchProfile],
  )

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      const cleanEmail = email.trim()
      if (!cleanEmail || !cleanEmail.includes('@')) {
        return {
          error: new Error('Please enter a valid email address containing @.'),
          user: null,
        }
      }

      const cleanDisplayName = displayName.trim() || cleanEmail.split('@')[0]
      if (cleanDisplayName.length < 2 || cleanDisplayName.length > 50) {
        return {
          error: new Error('Display name must be between 2 and 50 characters.'),
          user: null,
        }
      }

      if (password.length < 6) {
        return {
          error: new Error('Password must be at least 6 characters.'),
          user: null,
        }
      }

      // Real Supabase registration in live mode: surface real errors instead of
      // silently creating a local identity.
      const localAccountForEmail = findLocalUserByEmail(cleanEmail)
      if (configured && getDataSource() !== 'demo') {
        try {
          const { data, error } = await supabase.auth.signUp({
            email: cleanEmail,
            password,
            options: {
              data: {
                display_name: cleanDisplayName,
                full_name: cleanDisplayName,
              },
            },
          })

          if (error) {
            return {
              error,
              user: null,
            }
          }

          if (data.session && data.user) {
            setActiveLocalUser(null)
            setSession(data.session)
            setUser(data.user)

            const userProfile = await fetchProfile(data.user.id)
            setProfile(userProfile)

            return {
              error: null,
              user: data.user,
            }
          }

          // No session means the project still requires email confirmation.
          // Sign in immediately so registration lands in the app right away
          // instead of sending the user to a verification-email screen.
          if (data.user) {
            const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
              email: cleanEmail,
              password,
            })

            if (signInError || !signInData.session || !signInData.user) {
              return {
                error:
                  signInError ??
                  new Error('Account created, but automatic sign-in failed. Please sign in.'),
                user: data.user,
              }
            }

            setActiveLocalUser(null)
            setSession(signInData.session)
            setUser(signInData.user)

            const userProfile = await fetchProfile(signInData.user.id)
            setProfile(userProfile)

            return { error: null, user: signInData.user }
          }

          return { error: new Error('Registration failed.'), user: null }
        } catch (err) {
          return {
            error: err instanceof Error ? err : new Error(String(err)),
            user: null,
          }
        }
      }

      // Seamless instantaneous sign-up fallback (no email confirmation needed, no rate limits)
      const localUserId = localAccountForEmail?.id || crypto.randomUUID()
      const localUser: LocalUser = {
        id: localUserId,
        email: cleanEmail,
        displayName: cleanDisplayName,
        password,
        createdAt: localAccountForEmail?.createdAt || new Date().toISOString(),
      }

      saveLocalUser(localUser)
      setActiveLocalUser(localUser)

      const mockUser = createMockSupabaseUser(localUser)
      const mockProfile = createMockProfile(localUser)
      const mockSession = createMockSession(mockUser)

      setSession(mockSession)
      setUser(mockUser)
      setProfile(mockProfile)

      return {
        error: null,
        user: mockUser,
      }
    },
    [configured, fetchProfile],
  )

  const signOut = useCallback(async () => {
    setActiveLocalUser(null)
    setSession(null)
    setUser(null)
    setProfile(null)

    if (configured) {
      try {
        await supabase.auth.signOut()
      } catch {
        // non-blocking
      }
    }

    return { error: null }
  }, [configured])

  const isAdmin = isUserAdmin(user?.email)

  const value: AuthContextValue = {
    user,
    session,
    profile,
    isLoading,
    isConfigured: configured,
    isAdmin,
    signIn,
    signUp,
    signOut,
    refreshProfile,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
