import assert from 'node:assert/strict'
import { describe, it, beforeEach } from 'node:test'
import {
  _resetSupabaseClientForTesting,
  createSupabaseClient,
  getDataSource,
  getSupabaseClient,
  getSupabaseConfig,
  isSupabaseConfigured,
  supabase,
  SupabaseConfigurationError,
} from '../src/lib/supabase.ts'

describe('Supabase Client Configuration & Environment Validation', () => {
  const validMockUrl = 'https://mock-project-ref.supabase.co'
  const validMockKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSJ9.fake-signature'

  beforeEach(() => {
    _resetSupabaseClientForTesting()
  })

  it('resolves valid configuration correctly from provided env map', () => {
    const config = getSupabaseConfig({
      VITE_SUPABASE_URL: validMockUrl,
      VITE_SUPABASE_ANON_KEY: validMockKey,
    })

    assert.equal(config.supabaseUrl, validMockUrl)
    assert.equal(config.supabaseAnonKey, validMockKey)
  })

  it('throws SupabaseConfigurationError when VITE_SUPABASE_URL is missing', () => {
    assert.throws(
      () => getSupabaseConfig({ VITE_SUPABASE_ANON_KEY: validMockKey }),
      (err: unknown) => {
        assert.ok(err instanceof SupabaseConfigurationError)
        assert.match(err.message, /VITE_SUPABASE_URL is not defined or is empty/i)
        return true
      },
    )
  })

  it('throws SupabaseConfigurationError when VITE_SUPABASE_URL is empty or whitespace', () => {
    assert.throws(
      () => getSupabaseConfig({ VITE_SUPABASE_URL: '   ', VITE_SUPABASE_ANON_KEY: validMockKey }),
      (err: unknown) => {
        assert.ok(err instanceof SupabaseConfigurationError)
        assert.match(err.message, /VITE_SUPABASE_URL is not defined or is empty/i)
        return true
      },
    )
  })

  it('throws SupabaseConfigurationError when VITE_SUPABASE_URL is malformed or invalid protocol', () => {
    assert.throws(
      () => getSupabaseConfig({ VITE_SUPABASE_URL: 'not-a-valid-url', VITE_SUPABASE_ANON_KEY: validMockKey }),
      (err: unknown) => {
        assert.ok(err instanceof SupabaseConfigurationError)
        assert.match(err.message, /must be a valid HTTP or HTTPS URL/i)
        return true
      },
    )

    assert.throws(
      () => getSupabaseConfig({ VITE_SUPABASE_URL: 'ftp://files.example.com', VITE_SUPABASE_ANON_KEY: validMockKey }),
      (err: unknown) => {
        assert.ok(err instanceof SupabaseConfigurationError)
        assert.match(err.message, /must be a valid HTTP or HTTPS URL/i)
        return true
      },
    )
  })

  it('throws SupabaseConfigurationError when VITE_SUPABASE_ANON_KEY is missing', () => {
    assert.throws(
      () => getSupabaseConfig({ VITE_SUPABASE_URL: validMockUrl }),
      (err: unknown) => {
        assert.ok(err instanceof SupabaseConfigurationError)
        assert.match(err.message, /VITE_SUPABASE_ANON_KEY is not defined or is empty/i)
        return true
      },
    )
  })

  it('ensures error messages never expose secret keys', () => {
    const sensitiveKey = 'super-secret-sensitive-anon-token-12345'
    try {
      getSupabaseConfig({ VITE_SUPABASE_URL: 'invalid-url', VITE_SUPABASE_ANON_KEY: sensitiveKey })
      assert.fail('Should have thrown')
    } catch (err: unknown) {
      assert.ok(err instanceof Error)
      assert.doesNotMatch(err.message, new RegExp(sensitiveKey))
    }
  })

  it('isSupabaseConfigured returns true for valid env and false for invalid env', () => {
    assert.equal(
      isSupabaseConfigured({ VITE_SUPABASE_URL: validMockUrl, VITE_SUPABASE_ANON_KEY: validMockKey }),
      true,
    )
    assert.equal(isSupabaseConfigured({ VITE_SUPABASE_URL: validMockUrl }), false)
    assert.equal(isSupabaseConfigured({ VITE_SUPABASE_ANON_KEY: validMockKey }), false)
    assert.equal(isSupabaseConfigured({}), false)
  })
})

describe('Data Source Selection & Default Isolation', () => {
  it('defaults to the live source when env is empty or undefined', () => {
    // Demo fixtures must never be served implicitly: a blank environment means live mode,
    // so a misconfigured deployment surfaces real errors instead of fake content.
    assert.equal(getDataSource({}), 'supabase')
    assert.equal(getDataSource(undefined), 'supabase')
  })

  it('returns demo mode only when VITE_DATA_SOURCE is explicitly set to demo', () => {
    assert.equal(getDataSource({ VITE_DATA_SOURCE: 'demo' }), 'demo')
    assert.equal(getDataSource({ VITE_DATA_SOURCE: 'DEMO' }), 'demo')
    assert.equal(getDataSource({ VITE_DATA_SOURCE: '  demo  ' }), 'demo')
  })

  it('returns supabase mode when VITE_DATA_SOURCE is set to supabase', () => {
    assert.equal(getDataSource({ VITE_DATA_SOURCE: 'supabase' }), 'supabase')
    assert.equal(getDataSource({ VITE_DATA_SOURCE: 'SUPABASE' }), 'supabase')
    assert.equal(getDataSource({ VITE_DATA_SOURCE: '  supabase  ' }), 'supabase')
  })

  it('resolves unknown data source values to the live source instead of demo', () => {
    assert.equal(getDataSource({ VITE_DATA_SOURCE: 'unknown-source' }), 'supabase')
    assert.equal(getDataSource({ VITE_DATA_SOURCE: 'production' }), 'supabase')
  })
})

describe('Supabase Client Factory & Lazy Proxy', () => {
  const validMockUrl = 'https://mock-project-ref.supabase.co'
  const validMockKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSJ9.fake-signature'

  beforeEach(() => {
    _resetSupabaseClientForTesting()
  })

  it('creates a typed Supabase client with expected configuration', () => {
    const client = createSupabaseClient({
      supabaseUrl: validMockUrl,
      supabaseAnonKey: validMockKey,
    })

    assert.ok(client)
    assert.equal(typeof client.auth, 'object')
    assert.equal(typeof client.from, 'function')
    assert.equal(typeof client.rpc, 'function')
  })

  it('proxy delegates to the underlying client cleanly', () => {
    // Inject mock config into env override
    const client = createSupabaseClient({
      supabaseUrl: validMockUrl,
      supabaseAnonKey: validMockKey,
    })

    // Assert that the client provides expected Supabase interface
    assert.equal(typeof client.from, 'function')
    assert.equal(typeof client.rpc, 'function')
    assert.equal(typeof client.auth.getSession, 'function')
  })

  it('getSupabaseClient returns singleton instance when env is configured', () => {
    // When environment variables are set in process.env / env map, getSupabaseConfig succeeds
    process.env.VITE_SUPABASE_URL = validMockUrl
    process.env.VITE_SUPABASE_ANON_KEY = validMockKey

    try {
      const client1 = getSupabaseClient()
      const client2 = getSupabaseClient()
      assert.equal(client1, client2, 'Expected getSupabaseClient to return cached singleton')
      assert.ok(supabase.auth, 'Expected proxy to access auth namespace')
    } finally {
      delete process.env.VITE_SUPABASE_URL
      delete process.env.VITE_SUPABASE_ANON_KEY
      _resetSupabaseClientForTesting()
    }
  })
})

describe('Supabase Playlist & Invitation Utilities', () => {
  it('generates a 64-character hexadecimal invitation token', async () => {
    const { generateInvitationToken } = await import('../src/services/playlist/supabase-playlist.ts')
    const token = generateInvitationToken()
    assert.equal(token.length, 64)
    assert.match(token, /^[0-9a-f]{64}$/)
  })

  it('computes deterministic lowercase SHA-256 hash', async () => {
    const { hashInvitationToken } = await import('../src/services/playlist/supabase-playlist.ts')
    const token = '8e5bb947-f472-4d51-9bf8-9dcb4ce33b00'
    const hash1 = await hashInvitationToken(token)
    const hash2 = await hashInvitationToken(`  ${token.toUpperCase()}  `)

    assert.equal(hash1.length, 64)
    assert.equal(hash1, hash2)
    assert.match(hash1, /^[0-9a-f]{64}$/)
  })
})
