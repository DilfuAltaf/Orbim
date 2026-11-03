import { createClient, type SupabaseClient, type SupabaseClientOptions } from '@supabase/supabase-js'
import type { Database } from '../types/database.ts'

export type { Database } from '../types/database.ts'
export type { SupabaseClient } from '@supabase/supabase-js'

export type DataSource = 'demo' | 'supabase'

export interface SupabaseConfig {
  supabaseUrl: string
  supabaseAnonKey: string
}

/**
 * Custom error thrown when Supabase environment configuration is missing,
 * malformed, or invalid. Never echoes secret values in error messages.
 */
export class SupabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SupabaseConfigurationError'
  }
}

interface ProcessEnvHolder {
  process?: {
    env?: Record<string, string | undefined>
  }
}

function getNodeProcessEnv(): Record<string, string | undefined> | undefined {
  if (typeof globalThis !== 'undefined') {
    return (globalThis as ProcessEnvHolder).process?.env
  }
  return undefined
}

/**
 * Resolves and validates Supabase environment configuration.
 *
 * @param env Optional environment map override (useful for testing).
 * @throws {SupabaseConfigurationError} If required variables are missing or malformed.
 */
export function getSupabaseConfig(env?: Record<string, string | undefined>): SupabaseConfig {
  const nodeEnv = getNodeProcessEnv()
  const envMap =
    env !== undefined
      ? env
      : typeof import.meta !== 'undefined' && import.meta.env
        ? (import.meta.env as Record<string, string | undefined>)
        : nodeEnv !== undefined
          ? nodeEnv
          : {}

  const rawUrl = envMap.VITE_SUPABASE_URL?.trim()
  const rawKey = envMap.VITE_SUPABASE_ANON_KEY?.trim()

  if (!rawUrl) {
    throw new SupabaseConfigurationError(
      'Missing required Supabase configuration: VITE_SUPABASE_URL is not defined or is empty. Please check your .env.local file.',
    )
  }

  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Invalid protocol')
    }
  } catch {
    throw new SupabaseConfigurationError(
      'Invalid Supabase configuration: VITE_SUPABASE_URL must be a valid HTTP or HTTPS URL.',
    )
  }

  if (!rawKey) {
    throw new SupabaseConfigurationError(
      'Missing required Supabase configuration: VITE_SUPABASE_ANON_KEY is not defined or is empty. Please check your .env.local file.',
    )
  }

  return {
    supabaseUrl: rawUrl,
    supabaseAnonKey: rawKey,
  }
}

/**
 * Checks whether Supabase environment configuration is present and valid without throwing.
 */
export function isSupabaseConfigured(env?: Record<string, string | undefined>): boolean {
  try {
    getSupabaseConfig(env)
    return true
  } catch {
    return false
  }
}

/**
 * Resolves the active application data source mode.
 *
 * Live data is the default: ORBIM only serves the demo catalog when demo mode is
 * requested explicitly (`VITE_DATA_SOURCE=demo`). This prevents the application from
 * silently rendering fixtures while Supabase and Spotify are configured.
 * Unknown values resolve to the live source so a typo never masquerades as a working app.
 */
export function getDataSource(env?: Record<string, string | undefined>): DataSource {
  const nodeEnv = getNodeProcessEnv()
  const raw = (
    env !== undefined
      ? env.VITE_DATA_SOURCE
      : typeof import.meta !== 'undefined' && import.meta.env
        ? (import.meta.env.VITE_DATA_SOURCE as string | undefined)
        : nodeEnv?.VITE_DATA_SOURCE
  )?.trim().toLowerCase()

  return raw === 'demo' ? 'demo' : 'supabase'
}

/**
 * Factory that creates a new typed SupabaseClient instance.
 */
export function createSupabaseClient(
  config?: SupabaseConfig,
  options?: SupabaseClientOptions<'public'>,
): SupabaseClient<Database> {
  const resolvedConfig = config ?? getSupabaseConfig()

  return createClient<Database>(resolvedConfig.supabaseUrl, resolvedConfig.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    ...options,
  })
}

let cachedClient: SupabaseClient<Database> | null = null

/**
 * Returns the singleton typed SupabaseClient instance, initializing lazily on first access.
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (!cachedClient) {
    cachedClient = createSupabaseClient()
  }
  return cachedClient
}

/**
 * Resets the cached singleton client (for testing purposes only).
 */
export function _resetSupabaseClientForTesting(): void {
  cachedClient = null
}

/**
 * Lazy proxy to the singleton typed SupabaseClient instance.
 * Allows `import { supabase } from '@/lib/supabase'` without eager initialization errors.
 */
export const supabase: SupabaseClient<Database> = new Proxy({} as SupabaseClient<Database>, {
  get(_target, prop, receiver) {
    const client = getSupabaseClient()
    const value = Reflect.get(client, prop, receiver)
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(client) : value
  },
})

/**
 * Retrieves the current Supabase session access token, or null if unauthenticated.
 */
export async function getSupabaseAccessToken(): Promise<string | null> {
  try {
    const client = getSupabaseClient()
    const { data } = await client.auth.getSession()
    return data.session?.access_token || null
  } catch {
    return null
  }
}

/**
 * Returns an Authorization header object with the current Supabase session Bearer token,
 * or an empty object if no session is active.
 */
export async function getSupabaseAuthHeaders(): Promise<Record<string, string>> {
  const token = await getSupabaseAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

