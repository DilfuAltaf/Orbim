import assert from 'node:assert/strict'
import test, { beforeEach, afterEach } from 'node:test'
import {
  acceptServerInvitation,
  computeTokenHash,
  createServerInvitation,
  getServerInvitationPreview,
  _resetServerStoreForTesting,
  _setSupabaseClientForTesting,
} from '../src/server/user-invitation-service.ts'

interface DBStore {
  playlists: Array<{ id: string; title: string; owner_id: string; visibility: string; updated_at?: string }>
  playlist_invitations: Array<{
    id: string
    playlist_id: string
    token_hash: string | null
    role: string
    created_by: string
    invitee_id: string | null
    status: string
    expires_at: string
    accepted_at?: string | null
    accepted_by?: string | null
    responded_at?: string | null
    created_at?: string
  }>
  playlist_members: Array<{ playlist_id: string; user_id: string; role: string; joined_at: string }>
}

function createMockSupabase(store: DBStore, options: { failQuery?: boolean; failInsert?: boolean } = {}) {
  return {
    from: (tableName: string) => {
      return {
        select: (_columns: string) => {
          let filters: Array<(row: any) => boolean> = []
          const chain = {
            eq: (col: string, val: any) => {
              filters.push((row: any) => row[col] === val)
              return chain
            },
            order: (_col: string, _opts: any) => chain,
            maybeSingle: async () => {
              if (options.failQuery) {
                return { data: null, error: { message: 'Database connection failure' } }
              }
              const table = (store as any)[tableName] || []
              let matches = table.filter((row: any) => filters.every((f) => f(row)))
              if (matches.length === 0) return { data: null, error: null }
              const row = { ...matches[0] }
              if (tableName === 'playlist_invitations') {
                const pl = store.playlists.find((p) => p.id === row.playlist_id)
                row.playlists = pl ? { ...pl } : null
              }
              return { data: row, error: null }
            },
            then: (resolve: (res: any) => void) => {
              if (options.failQuery) {
                resolve({ data: null, error: { message: 'Database connection failure' } })
                return
              }
              const table = (store as any)[tableName] || []
              let matches = table.filter((row: any) => filters.every((f) => f(row)))
              if (tableName === 'playlist_invitations') {
                matches = matches.map((r: any) => {
                  const pl = store.playlists.find((p) => p.id === r.playlist_id)
                  return { ...r, playlists: pl ? { ...pl } : null }
                })
              }
              resolve({ data: matches, error: null })
            },
          }
          return chain
        },
        insert: async (data: any) => {
          if (options.failInsert) {
            return { error: { message: 'Failed to insert row' } }
          }
          const table = (store as any)[tableName] || []
          table.push({ ...data, created_at: new Date().toISOString() })
          return { error: null }
        },
        update: (updates: any) => {
          let filters: Array<(row: any) => boolean> = []
          const chain = {
            eq: (col: string, val: any) => {
              filters.push((row: any) => row[col] === val)
              return chain
            },
            then: (resolve: (res: any) => void) => {
              const table = (store as any)[tableName] || []
              for (const row of table) {
                if (filters.every((f) => f(row))) {
                  Object.assign(row, updates)
                }
              }
              resolve({ error: null })
            },
          }
          return chain
        },
        upsert: async (data: any, _opts?: any) => {
          const table = (store as any)[tableName] || []
          const idx = table.findIndex(
            (r: any) => r.playlist_id === data.playlist_id && r.user_id === data.user_id,
          )
          if (idx >= 0) {
            table[idx] = { ...table[idx], ...data }
          } else {
            table.push({ ...data })
          }
          return { error: null }
        },
      }
    },
    rpc: async (_fn: string, _params: any) => {
      return { data: null, error: { message: 'RPC not implemented in mock' } }
    },
  } as any
}

test('Phase 3: Supabase Invitation Persistence & Lifecycle', async (t) => {
  let db: DBStore
  const originalEnv = process.env.NODE_ENV
  const originalVercel = process.env.VERCEL

  beforeEach(() => {
    db = {
      playlists: [
        { id: 'playlist-alpha', title: 'Alpha Vibes', owner_id: 'user-owner', visibility: 'private' },
      ],
      playlist_invitations: [],
      playlist_members: [],
    }
    _resetServerStoreForTesting()
    _setSupabaseClientForTesting(createMockSupabase(db))
  })

  afterEach(() => {
    _resetServerStoreForTesting()
    process.env.NODE_ENV = originalEnv
    if (originalVercel !== undefined) {
      process.env.VERCEL = originalVercel
    } else {
      delete process.env.VERCEL
    }
  })

  await t.test('1. Invitation creation persists hash in Supabase, never raw token', async () => {
    const rawToken = 'secret-invitation-token-123456789'
    const tokenHash = computeTokenHash(rawToken)

    const res = await createServerInvitation({
      playlistId: 'playlist-alpha',
      createdBy: 'user-owner',
      rawToken,
    })

    assert.equal(res.success, true)
    assert.equal(res.outcome, 'created')
    assert.equal(db.playlist_invitations.length, 1)

    const saved = db.playlist_invitations[0]
    assert.equal(saved.playlist_id, 'playlist-alpha')
    assert.equal(saved.token_hash, tokenHash)
    assert.equal((saved as any).rawToken, undefined, 'Raw token must never be written to database')
    assert.equal(saved.status, 'pending')
  })

  await t.test('2. Invitation lookup and preview across independent service instances', async () => {
    const rawToken = 'cross-instance-token-9876543210'

    // Instance 1 creates the invitation
    await createServerInvitation({
      playlistId: 'playlist-alpha',
      createdBy: 'user-owner',
      rawToken,
    })

    // Reset in-memory cache to simulate separate serverless instance 2
    _resetServerStoreForTesting()
    _setSupabaseClientForTesting(createMockSupabase(db))

    // Instance 2 previews the invitation using only raw token
    const preview = await getServerInvitationPreview(rawToken)
    assert.equal(preview.found, true)
    assert.equal(preview.invitation?.playlistTitle, 'Alpha Vibes')
    assert.equal(preview.invitation?.status, 'pending')
    assert.equal((preview.invitation as any)?.rawToken, undefined)
    assert.equal((preview.invitation as any)?.tokenHash, undefined)
  })

  await t.test('3. Expired invitation is rejected and cannot be accepted', async () => {
    const rawToken = 'expired-token-00000000000000'
    const past = new Date(Date.now() - 60000).toISOString()

    // Insert directly into DB as expired
    db.playlist_invitations.push({
      id: 'inv-expired',
      playlist_id: 'playlist-alpha',
      token_hash: computeTokenHash(rawToken),
      role: 'editor',
      created_by: 'user-owner',
      invitee_id: null,
      status: 'pending',
      expires_at: past,
    })

    const preview = await getServerInvitationPreview(rawToken)
    assert.equal(preview.found, false)
    assert.equal(preview.errorKind, 'expired')

    const acceptRes = await acceptServerInvitation({
      token: rawToken,
      userId: 'user-collaborator',
    })
    assert.equal(acceptRes.success, false)
    assert.equal(acceptRes.errorKind, 'expired')
  })

  await t.test('4. Invalid or short token is rejected immediately', async () => {
    const invalidTokens = ['', 'short', '   ', 'token-under-16-c']
    for (const token of invalidTokens) {
      const res = await acceptServerInvitation({
        token,
        userId: 'user-collaborator',
      })
      assert.equal(res.success, false)
      assert.equal(res.errorKind, 'invalid')
    }

    const nonExistent = await acceptServerInvitation({
      token: 'non-existent-token-that-has-sufficient-length',
      userId: 'user-collaborator',
    })
    assert.equal(nonExistent.success, false)
    assert.equal(nonExistent.errorKind, 'invalid')
  })

  await t.test('5. Successful invitation acceptance updates status and adds member', async () => {
    const rawToken = 'valid-acceptance-token-1122334455'
    await createServerInvitation({
      playlistId: 'playlist-alpha',
      createdBy: 'user-owner',
      rawToken,
    })

    const res = await acceptServerInvitation({
      token: rawToken,
      userId: 'user-new-member',
    })

    assert.equal(res.success, true)
    assert.equal(res.status, 'joined')
    assert.equal(res.playlistId, 'playlist-alpha')

    // Check DB state
    const inv = db.playlist_invitations[0]
    assert.equal(inv.status, 'accepted')
    assert.equal(inv.accepted_by, 'user-new-member')

    assert.equal(db.playlist_members.length, 1)
    assert.equal(db.playlist_members[0].user_id, 'user-new-member')
    assert.equal(db.playlist_members[0].playlist_id, 'playlist-alpha')

    const pl = db.playlists.find((p) => p.id === 'playlist-alpha')
    assert.equal(pl?.visibility, 'shared')
  })

  await t.test('6. Repeated acceptance is idempotent for member and blocked for others', async () => {
    const rawToken = 'idempotent-token-554433221100'
    await createServerInvitation({
      playlistId: 'playlist-alpha',
      createdBy: 'user-owner',
      rawToken,
    })

    // First acceptance
    const res1 = await acceptServerInvitation({
      token: rawToken,
      userId: 'user-member-one',
    })
    assert.equal(res1.success, true)
    assert.equal(res1.status, 'joined')

    // Repeated acceptance by the same user: idempotent success
    const res2 = await acceptServerInvitation({
      token: rawToken,
      userId: 'user-member-one',
    })
    assert.equal(res2.success, true)
    assert.equal(res2.status, 'already_member')

    // Acceptance attempt by a different user: blocked with already_accepted
    const res3 = await acceptServerInvitation({
      token: rawToken,
      userId: 'user-other-person',
    })
    assert.equal(res3.success, false)
    assert.equal(res3.errorKind, 'already_accepted')
  })

  await t.test('7. Supabase failure handling in production fails closed without silent fallback', async () => {
    process.env.NODE_ENV = 'production'
    process.env.VERCEL = '1'

    // Configure Supabase client that fails on insert
    _setSupabaseClientForTesting(createMockSupabase(db, { failInsert: true }))

    const res = await createServerInvitation({
      playlistId: 'playlist-alpha',
      createdBy: 'user-owner',
      rawToken: 'token-should-fail-persistence-production-99',
    })

    assert.equal(res.success, false)
    assert.equal(res.errorKind, 'server')
    assert.match(res.error || '', /Failed to persist invitation in database/)
  })
})
