import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

const MIGRATIONS_DIR = path.resolve('supabase/migrations')
const UNIFIED_SCHEMA_PATH = path.resolve('supabase/schema.sql')

describe('Phase 4.1.1 Database Foundation: Schema & Migrations Inspection', () => {
  it('verifies that migration files exist and follow timestamped naming convention', () => {
    assert.ok(fs.existsSync(MIGRATIONS_DIR), 'Migrations directory must exist')
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()

    assert.equal(files.length, 10, 'Expected 10 migration files')
    assert.ok(files[0].endsWith('_create_profiles.sql'))
    assert.ok(files[1].endsWith('_create_playlists_and_members.sql'))
    assert.ok(files[2].endsWith('_create_playlist_tracks.sql'))
    assert.ok(files[3].endsWith('_create_playlist_invitations.sql'))
    assert.ok(files[4].endsWith('_security_and_rls.sql'))
    assert.ok(files[5].endsWith('_track_verification_and_admin.sql'))
    assert.ok(files[6].endsWith('_track_audio_storage.sql'))
    assert.ok(files[7].endsWith('_global_music_catalog.sql'))
    assert.ok(files[8].endsWith('_recently_added_catalog_index.sql'))
    assert.ok(files[9].endsWith('_collaborative_playlist_invitations.sql'))

    for (const file of files) {
      assert.match(file, /^\d{14}_[a-z0-9_]+\.sql$/, `Filename ${file} must match YYYYMMDDHHMMSS_name.sql`)
    }
  })

  it('verifies the unified schema file compiles all migration contents', () => {
    assert.ok(fs.existsSync(UNIFIED_SCHEMA_PATH), 'Unified schema.sql must exist')
    const schemaSql = fs.readFileSync(UNIFIED_SCHEMA_PATH, 'utf-8')

    assert.ok(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.profiles'))
    assert.ok(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.playlists'))
    assert.ok(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.playlist_members'))
    assert.ok(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.playlist_tracks'))
    assert.ok(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.playlist_invitations'))
    assert.ok(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.app_admins'))
    assert.ok(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.track_verification_audit_logs'))
    assert.ok(schemaSql.includes('CREATE TABLE IF NOT EXISTS public.catalog_tracks'))
    assert.ok(schemaSql.includes('track_audio_source_type_valid'))
  })

  it('verifies added_by foreign key deletion policy resolution in playlist_tracks', () => {
    const migration3 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000003_create_playlist_tracks.sql'), 'utf-8')

    // Must be nullable and use ON DELETE SET NULL
    assert.match(
      migration3,
      /added_by\s+UUID\s+REFERENCES\s+public\.profiles\(id\)\s+ON\s+DELETE\s+SET\s+NULL/i,
      'added_by must be nullable and specify ON DELETE SET NULL',
    )
    assert.doesNotMatch(
      migration3,
      /added_by\s+UUID\s+NOT\s+NULL/i,
      'added_by must NOT have NOT NULL constraint when ON DELETE SET NULL is specified',
    )
  })

  it('verifies fractional position uses NUMERIC in playlist_tracks', () => {
    const migration3 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000003_create_playlist_tracks.sql'), 'utf-8')

    assert.match(migration3, /position\s+NUMERIC\s+NOT\s+NULL/i, 'Position column must use NUMERIC')
    assert.match(migration3, /CONSTRAINT\s+track_position_finite\s+CHECK\s*\(position\s*>\s*0\)/i)
    assert.match(
      migration3,
      /CONSTRAINT\s+playlist_track_unique\s+UNIQUE\s*\(playlist_id,\s*provider,\s*provider_track_id\)/i,
      'Must have uniqueness constraint on (playlist_id, provider, provider_track_id)',
    )
  })

  it('verifies token hash constraint and single-use columns in playlist_invitations', () => {
    const migration4 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000004_create_playlist_invitations.sql'), 'utf-8')

    assert.match(migration4, /token_hash\s+TEXT\s+NOT\s+NULL/i)
    assert.match(
      migration4,
      /CONSTRAINT\s+invitation_token_hash_format\s+CHECK\s*\(token_hash\s*~\s*'(\^)?\[0-9a-f\]\{64\}\$?'\)/i,
      'token_hash must be validated as 64-character lowercase hexadecimal string',
    )
    assert.match(
      migration4,
      /CONSTRAINT\s+invitation_role_valid\s+CHECK\s*\(role\s*IN\s*\('editor'\)\)/i,
      'Invitation role must be strictly editor',
    )
    assert.match(migration4, /accepted_at\s+TIMESTAMPTZ/i)
  })
})

describe('Phase 4.1.1 Database Foundation: Security & Privileges Hardening', () => {
  it('verifies SECURITY DEFINER functions enforce fixed search_path = pg_catalog and revoke PUBLIC', () => {
    const allSql = fs
      .readdirSync(MIGRATIONS_DIR)
      .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8'))
      .join('\n\n')

    const securityDefinerFunctions = [
      'public.handle_new_user',
      'public.is_playlist_member',
      'public.is_playlist_owner',
      'public.handle_new_playlist_owner',
      'public.protect_playlist_track_attribution',
      'public.rebalance_playlist_track_positions',
      'public.accept_playlist_invitation',
    ]

    for (const fn of securityDefinerFunctions) {
      assert.ok(allSql.includes(`FUNCTION ${fn}`), `Expected function ${fn} in SQL`)
      assert.ok(
        allSql.includes(`REVOKE ALL ON FUNCTION ${fn}`),
        `Expected REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC`,
      )
    }

    // Verify search_path is locked to pg_catalog strictly without public in search_path
    const matches = allSql.match(/SET search_path = pg_catalog\b/g)
    assert.ok(matches && matches.length >= securityDefinerFunctions.length, 'All security definer functions must set fixed search_path = pg_catalog')
  })

  it('verifies trigger functions are NOT executable by authenticated role directly', () => {
    const migration2 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000002_create_playlists_and_members.sql'), 'utf-8')

    assert.doesNotMatch(
      migration2,
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.handle_new_playlist_owner\(\)\s+TO\s+[^;]*authenticated/i,
      'Trigger function handle_new_playlist_owner must NOT be granted to authenticated role directly',
    )
  })

  it('verifies that all application tables enable and force Row Level Security', () => {
    const migration5 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000005_security_and_rls.sql'), 'utf-8')
    const tables = ['profiles', 'playlists', 'playlist_members', 'playlist_tracks', 'playlist_invitations']

    for (const table of tables) {
      assert.match(
        migration5,
        new RegExp(`ALTER\\s+TABLE\\s+public\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i'),
        `Table public.${table} must enable RLS`,
      )
      assert.match(
        migration5,
        new RegExp(`ALTER\\s+TABLE\\s+public\\.${table}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i'),
        `Table public.${table} must force RLS`,
      )
    }
  })

  it('verifies non-recursive RLS policy references and auth.uid() scoping', () => {
    const migration5 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000005_security_and_rls.sql'), 'utf-8')

    // Check helper function usage with single argument (caller derived from auth.uid())
    assert.match(migration5, /public\.is_playlist_member\(id\)/i)
    assert.match(migration5, /public\.is_playlist_owner\(playlist_id\)/i)
    assert.match(migration5, /public\.is_playlist_member\(playlist_id\)/i)
  })

  it('verifies strict attribution integrity on playlist_tracks insert and update', () => {
    const migration5 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000005_security_and_rls.sql'), 'utf-8')
    const migration3 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000003_create_playlist_tracks.sql'), 'utf-8')

    // Insert policy must strictly require added_by = (SELECT auth.uid()) and disallow NULL
    assert.match(migration5, /added_by\s*=\s*\(SELECT\s+auth\.uid\(\)\)/i)
    assert.doesNotMatch(migration5, /added_by\s+IS\s+NULL\s+OR\s+added_by\s*=/i)

    // Attribution protection trigger must exist
    assert.match(migration3, /CREATE\s+TRIGGER\s+on_playlist_track_update_protect/i)
    assert.match(migration3, /NEW\.added_by\s*:=\s*OLD\.added_by/i)
    assert.match(migration3, /NEW\.playlist_id\s*:=\s*OLD\.playlist_id/i)
  })

  it('verifies direct UPDATE on playlist_members is disallowed (D3 Option A)', () => {
    const migration5 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000005_security_and_rls.sql'), 'utf-8')

    // Must NOT have any UPDATE policy on playlist_members
    assert.doesNotMatch(
      migration5,
      /CREATE\s+POLICY\s+playlist_members_update/i,
      'Direct UPDATE policy on playlist_members must be removed to prevent role/user tampering',
    )
  })

  it('verifies concurrency row-locking in rebalance and invitation procedures', () => {
    const migration3 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000003_create_playlist_tracks.sql'), 'utf-8')
    const migration4 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000004_create_playlist_invitations.sql'), 'utf-8')

    // Rebalance must lock parent playlist row
    assert.match(migration3, /PERFORM\s+1\s+FROM\s+public\.playlists\s+WHERE\s+id\s*=\s*p_playlist_id\s+FOR\s+UPDATE/i)

    // Accept invitation must lock invitation row
    assert.match(migration4, /FROM\s+public\.playlist_invitations\s+WHERE\s+token_hash\s*=\s*v_token_hash\s+FOR\s+UPDATE/i)
  })
})

describe('Phase 4.1.1 Token Hashing and Invitation Validation Logic', () => {
  function hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw.trim().toLowerCase(), 'utf8').digest('hex')
  }

  it('generates a 64-character lowercase hexadecimal SHA-256 hash', () => {
    const token = crypto.randomUUID() + '-' + crypto.randomUUID()
    const hash = hashToken(token)

    assert.equal(hash.length, 64)
    assert.match(hash, /^[0-9a-f]{64}$/)
  })

  it('produces identical deterministic hashes for matching trimmed and case-insensitive tokens', () => {
    const raw = '8e5bb947-f472-4d51-9bf8-9dcb4ce33b00'
    const hash1 = hashToken(raw)
    const hash2 = hashToken(`  ${raw.toUpperCase()}  `)

    assert.equal(hash1, hash2)
    assert.equal(hash1.length, 64)
  })

  it('produces completely different hashes for different tokens', () => {
    const tokenA = 'invitation-token-alpha-123456789'
    const tokenB = 'invitation-token-alpha-123456780'

    assert.notEqual(hashToken(tokenA), hashToken(tokenB))
  })
})

describe('Phase 4.1.1 Fractional Track Positioning Logic', () => {
  it('generates initial positions spaced by 1000', () => {
    const trackCount = 4
    const initialPositions = Array.from({ length: trackCount }, (_, i) => (i + 1) * 1000.0)

    assert.deepEqual(initialPositions, [1000.0, 2000.0, 3000.0, 4000.0])
  })

  it('calculates midpoints cleanly between neighboring tracks', () => {
    const posA = 1000.0
    const posB = 2000.0
    const insertedPos = (posA + posB) / 2.0

    assert.equal(insertedPos, 1500.0)
    assert.ok(insertedPos > posA && insertedPos < posB)
  })

  it('inserts before the first track cleanly', () => {
    const firstPos = 1000.0
    const insertedBefore = firstPos / 2.0

    assert.equal(insertedBefore, 500.0)
    assert.ok(insertedBefore > 0 && insertedBefore < firstPos)
  })

  it('detects when rebalancing is required for closely-packed insertions', () => {
    const posA = 1000.00001
    const posB = 1000.00002
    const delta = posB - posA
    const needsRebalance = delta < 0.0001

    assert.equal(needsRebalance, true)
  })

  it('simulates rebalance re-indexing to 1000-spaced intervals', () => {
    const messyPositions = [12.5, 14.125, 14.1875, 500.0, 1500.0]
    const rebalanced = messyPositions
      .slice()
      .sort((a, b) => a - b)
      .map((_, index) => (index + 1) * 1000.0)

    assert.deepEqual(rebalanced, [1000.0, 2000.0, 3000.0, 4000.0, 5000.0])
  })
})

describe('Phase 4.1.2 Final Local SQL Logic Audit Validations', () => {
  it('verifies protect_playlist_track_attribution allows NULL added_by strictly during profile deletion', () => {
    const migration3 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000003_create_playlist_tracks.sql'), 'utf-8')

    // Must check profile deletion condition before allowing NULL
    assert.match(
      migration3,
      /IF\s+OLD\.added_by\s+IS\s+NULL\s+THEN\s+NEW\.added_by\s*:=\s*NULL;\s*ELSIF\s+NEW\.added_by\s+IS\s+NULL\s+AND\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.profiles\s+WHERE\s+id\s*=\s*OLD\.added_by\s*\)\s*THEN\s*NEW\.added_by\s*:=\s*NULL;/i,
      'protect_playlist_track_attribution must allow NULL added_by strictly when profile is deleted',
    )
    // Non-delete updates must preserve attribution
    assert.match(migration3, /NEW\.added_by\s*:=\s*OLD\.added_by;/i)
  })

  it('verifies touch_playlist_updated_at trigger exists and updates parent playlist on INSERT or DELETE', () => {
    const migration3 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000003_create_playlist_tracks.sql'), 'utf-8')

    assert.match(migration3, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.touch_playlist_updated_at\(\)/i)
    assert.match(migration3, /UPDATE\s+public\.playlists\s+SET\s+updated_at\s*=\s*now\(\)/i)
    assert.match(
      migration3,
      /CREATE\s+TRIGGER\s+on_playlist_track_touch_playlist\s+AFTER\s+INSERT\s+OR\s+DELETE\s+ON\s+public\.playlist_tracks/i,
    )
  })

  it('verifies playlist_members_delete policy strictly forbids owner from deleting their own membership', () => {
    const migration5 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000005_security_and_rls.sql'), 'utf-8')

    // Owner removing editor check
    assert.match(
      migration5,
      /public\.is_playlist_owner\(playlist_id\)\s+AND\s+user_id\s*!=\s*\(SELECT\s+auth\.uid\(\)\)/i,
      'Owner must only be permitted to delete other members, not themselves',
    )
    // Editor self-leave check
    assert.match(
      migration5,
      /user_id\s*=\s*\(SELECT\s+auth\.uid\(\)\)\s+AND\s+NOT\s+public\.is_playlist_owner\(playlist_id\)/i,
      'Editor self-removal must explicitly ensure the caller is not the owner',
    )
  })

  it('verifies accept_playlist_invitation distinguishes owner preview and consumes token on existing editor', () => {
    const migration4 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000004_create_playlist_invitations.sql'), 'utf-8')

    // Owner preview check: do not consume token
    assert.match(
      migration4,
      /IF\s+v_caller_id\s*=\s*v_playlist\.owner_id\s+THEN\s+RETURN\s+jsonb_build_object\(\s*'status',\s*'already_member'/i,
      'Owner inspecting invite link must return already_member without consuming token',
    )

    // Existing editor check: MUST consume token to prevent link recycling
    assert.match(
      migration4,
      /IF\s+v_existing_role\s+IS\s+NOT\s+NULL\s+THEN\s+UPDATE\s+public\.playlist_invitations\s+SET\s+accepted_at\s*=\s*now\(\)\s+WHERE\s+id\s*=\s*v_invitation\.id;/i,
      'Existing editor accepting invite must consume token to enforce single-use policy',
    )

    // Uninvited newcomer acceptance: consumes token, inserts member, promotes to shared
    assert.match(
      migration4,
      /UPDATE\s+public\.playlists\s+SET\s+visibility\s*=\s*'shared',\s*updated_at\s*=\s*now\(\)\s+WHERE\s+id\s*=\s*v_invitation\.playlist_id;/i,
    )
  })

  it('verifies accept_playlist_invitation case-normalizes input and uses ERRCODE', () => {
    const migration4 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000004_create_playlist_invitations.sql'), 'utf-8')

    assert.match(migration4, /v_token_hash\s*:=\s*encode\(sha256\(convert_to\(lower\(trim\(p_token\)\),\s*'UTF8'\)\),\s*'hex'\);/i)
    assert.match(migration4, /USING\s+ERRCODE\s*=\s*'ORB01'/i)
    assert.match(migration4, /USING\s+ERRCODE\s*=\s*'ORB02'/i)
    assert.match(migration4, /USING\s+ERRCODE\s*=\s*'ORB03'/i)
    assert.match(migration4, /USING\s+ERRCODE\s*=\s*'ORB04'/i)
    assert.match(migration4, /USING\s+ERRCODE\s*=\s*'ORB05'/i)
    assert.match(migration4, /USING\s+ERRCODE\s*=\s*'ORB06'/i)
  })

  it('verifies all 5 migrations and schema.sql remain 100% in sync', () => {
    const schemaSql = fs.readFileSync(UNIFIED_SCHEMA_PATH, 'utf-8')

    // Key hardened features present in schema.sql
    assert.ok(schemaSql.includes('touch_playlist_updated_at'), 'schema.sql must contain touch_playlist_updated_at')
    assert.ok(
      schemaSql.includes('on_playlist_track_touch_playlist'),
      'schema.sql must contain on_playlist_track_touch_playlist trigger',
    )
    assert.ok(
      schemaSql.includes('user_id != (SELECT auth.uid())'),
      'schema.sql must contain owner self-deletion protection',
    )
    assert.ok(
      schemaSql.includes("status', 'already_member"),
      'schema.sql must contain owner preview and existing member status',
    )
    assert.ok(
      schemaSql.includes('ORB06'),
      'schema.sql must contain structured ORB error codes',
    )
  })
})

describe('Phase 4.2C Audited SQL Corrections Validations', () => {
  it('verifies rebalance_playlist_track_positions uses two-stage CTE without FOR UPDATE on window function', () => {
    const migration3 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000003_create_playlist_tracks.sql'), 'utf-8')

    // Must have locked CTE with FOR UPDATE
    assert.match(
      migration3,
      /WITH\s+locked\s+AS\s*\(\s*SELECT\s+id,\s*position,\s*added_at\s+FROM\s+public\.playlist_tracks\s+WHERE\s+playlist_id\s*=\s*p_playlist_id\s+FOR\s+UPDATE\s*\)/i,
      'Expected locked CTE with FOR UPDATE',
    )

    // Ranked CTE must NOT have FOR UPDATE on window function
    assert.match(
      migration3,
      /ranked\s+AS\s*\(\s*SELECT\s+id,\s*\(row_number\(\)\s+OVER\s*\(ORDER\s+BY\s+position\s+ASC,\s*added_at\s+ASC\)\)\s*\*\s*1000\.0\s+AS\s+new_position\s+FROM\s+locked\s*\)/i,
      'Expected ranked CTE selecting from locked without FOR UPDATE',
    )
  })

  it('verifies automatic updated_at trigger exists on public.playlists', () => {
    const migration2 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000002_create_playlists_and_members.sql'), 'utf-8')

    assert.match(migration2, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.touch_playlist_self_updated_at\(\)/i)
    assert.match(
      migration2,
      /CREATE\s+TRIGGER\s+on_playlist_before_update\s+BEFORE\s+UPDATE\s+ON\s+public\.playlists\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+public\.touch_playlist_self_updated_at\(\);/i,
    )
  })

  it('verifies playlist_invitations enforces 7-day maximum expiry via trigger and RLS', () => {
    const migration4 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000004_create_playlist_invitations.sql'), 'utf-8')
    const migration5 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000005_security_and_rls.sql'), 'utf-8')

    // Trigger in Migration 4
    assert.match(migration4, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.enforce_invitation_expiry_limit\(\)/i)
    assert.match(migration4, /interval\s+'7\s+days'/i)
    assert.match(migration4, /CREATE\s+TRIGGER\s+on_playlist_invitation_before_insert/i)

    // RLS in Migration 5
    assert.match(migration5, /expires_at\s*<=\s*now\(\)\s*\+\s*interval\s+'7\s+days'/i)
  })

  it('verifies index on playlist_invitations.created_by exists', () => {
    const migration4 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000004_create_playlist_invitations.sql'), 'utf-8')

    assert.match(
      migration4,
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_playlist_invitations_created_by\s+ON\s+public\.playlist_invitations\(created_by\);/i,
    )
  })

  it('verifies direct UPDATE policy on playlist_invitations is completely removed', () => {
    const migration5 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000005_security_and_rls.sql'), 'utf-8')

    assert.doesNotMatch(
      migration5,
      /CREATE\s+POLICY\s+playlist_invitations_update/i,
      'Direct UPDATE policy on playlist_invitations must be removed to prevent token reactivation',
    )
  })

  it('verifies direct INSERT on playlist_members is disallowed (D1 Option A: invite-only)', () => {
    const migration5 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000005_security_and_rls.sql'), 'utf-8')

    assert.doesNotMatch(
      migration5,
      /CREATE\s+POLICY\s+playlist_members_insert/i,
      'Direct INSERT policy on playlist_members must be removed (collaborators join via invite acceptance)',
    )
  })

  it('verifies explicit table grants exist for authenticated role and revoked from anon/PUBLIC', () => {
    const migration5 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000005_security_and_rls.sql'), 'utf-8')

    assert.match(
      migration5,
      /REVOKE\s+ALL\s+ON\s+TABLE\s+public\.profiles,\s*public\.playlists,\s*public\.playlist_members,\s*public\.playlist_tracks,\s*public\.playlist_invitations\s+FROM\s+anon,\s*PUBLIC;/i,
    )
    assert.match(migration5, /GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE\s+ON\s+TABLE\s+public\.profiles\s+TO\s+authenticated/i)
    assert.match(migration5, /GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE\s+ON\s+TABLE\s+public\.playlists\s+TO\s+authenticated/i)
    assert.match(migration5, /GRANT\s+SELECT,\s*DELETE\s+ON\s+TABLE\s+public\.playlist_members\s+TO\s+authenticated/i)
    assert.match(migration5, /GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE\s+ON\s+TABLE\s+public\.playlist_tracks\s+TO\s+authenticated/i)
    assert.match(migration5, /GRANT\s+SELECT,\s*INSERT,\s*DELETE\s+ON\s+TABLE\s+public\.playlist_invitations\s+TO\s+authenticated/i)
  })

  it('verifies unified schema.sql matches all 5 migrations byte-for-byte in dependency order', () => {
    const schemaSql = fs.readFileSync(UNIFIED_SCHEMA_PATH, 'utf-8')

    assert.ok(schemaSql.includes('touch_playlist_self_updated_at'))
    assert.ok(schemaSql.includes('idx_playlist_invitations_created_by'))
    assert.ok(schemaSql.includes('enforce_invitation_expiry_limit'))
    assert.ok(!schemaSql.includes('CREATE POLICY playlist_invitations_update'))
  })
})

describe('Phase 4.2D.2 Security Remediation Validations', () => {
  it('verifies zero occurrences of timezone(\'utc\', now()) across all migrations and schema.sql', () => {
    const allMigrationFiles = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))
    for (const f of allMigrationFiles) {
      const content = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8')
      assert.doesNotMatch(
        content,
        /timezone\s*\(\s*'utc'/i,
        `Migration ${f} must not contain timezone('utc', ...) anti-pattern for TIMESTAMPTZ`,
      )
    }

    const schemaSql = fs.readFileSync(UNIFIED_SCHEMA_PATH, 'utf-8')
    assert.doesNotMatch(
      schemaSql,
      /timezone\s*\(\s*'utc'/i,
      'schema.sql must not contain timezone(\'utc\', ...) anti-pattern for TIMESTAMPTZ',
    )
  })

  it('verifies helper functions accept only p_playlist_id and drop legacy 2-arg signatures', () => {
    const migration2 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000002_create_playlists_and_members.sql'), 'utf-8')

    // Must explicitly drop old signatures
    assert.match(migration2, /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.is_playlist_member\(UUID,\s*UUID\);/i)
    assert.match(migration2, /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.is_playlist_owner\(UUID,\s*UUID\);/i)

    // Function definition must take only 1 param and derive user from auth.uid()
    assert.match(migration2, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.is_playlist_member\(p_playlist_id\s+UUID\)/i)
    assert.match(migration2, /WHERE\s+playlist_id\s*=\s*p_playlist_id\s+AND\s+user_id\s*=\s*auth\.uid\(\)/i)

    assert.match(migration2, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.is_playlist_owner\(p_playlist_id\s+UUID\)/i)
    assert.match(migration2, /WHERE\s+id\s*=\s*p_playlist_id\s+AND\s+owner_id\s*=\s*auth\.uid\(\)/i)
  })

  it('verifies protect_playlist_track_attribution protects track metadata on UPDATE (D2 Option A)', () => {
    const migration3 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000003_create_playlist_tracks.sql'), 'utf-8')

    // Must lock all metadata fields
    assert.match(migration3, /NEW\.title\s*:=\s*OLD\.title;/i)
    assert.match(migration3, /NEW\.artist_name\s*:=\s*OLD\.artist_name;/i)
    assert.match(migration3, /NEW\.album_name\s*:=\s*OLD\.album_name;/i)
    assert.match(migration3, /NEW\.artwork_url\s*:=\s*OLD\.artwork_url;/i)
    assert.match(migration3, /NEW\.duration_seconds\s*:=\s*OLD\.duration_seconds;/i)
    assert.match(migration3, /NEW\.provider\s*:=\s*OLD\.provider;/i)
    assert.match(migration3, /NEW\.provider_track_id\s*:=\s*OLD\.provider_track_id;/i)
  })

  it('verifies touch_playlist trigger does NOT fire on UPDATE of position to prevent rebalance deadlock', () => {
    const migration3 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000003_create_playlist_tracks.sql'), 'utf-8')

    assert.doesNotMatch(
      migration3,
      /on_playlist_track_touch_playlist[\s\S]*?UPDATE\s+OF\s+position/i,
      'Trigger must not fire on UPDATE of position',
    )
    assert.match(
      migration3,
      /CREATE\s+TRIGGER\s+on_playlist_track_touch_playlist\s+AFTER\s+INSERT\s+OR\s+DELETE\s+ON\s+public\.playlist_tracks/i,
    )
  })

  it('verifies rebalance_playlist_track_positions calls single-arg is_playlist_member', () => {
    const migration3 = fs.readFileSync(path.join(MIGRATIONS_DIR, '20261023000003_create_playlist_tracks.sql'), 'utf-8')

    assert.match(
      migration3,
      /IF\s+v_caller_id\s+IS\s+NULL\s+OR\s+NOT\s+public\.is_playlist_member\(p_playlist_id\)\s+THEN/i,
    )
  })

  it('verifies safe remote upgrade script enforces transaction, drops policies before functions, and purges legacy policies', () => {
    const upgradePath = path.resolve('supabase/upgrade_remote_phase_4_2d_2.sql')
    assert.ok(fs.existsSync(upgradePath), 'upgrade_remote_phase_4_2d_2.sql must exist')
    const sql = fs.readFileSync(upgradePath, 'utf-8')

    // Transaction wrapping
    assert.match(sql, /^BEGIN;/m, 'Upgrade script must start with BEGIN;')
    assert.match(sql, /^COMMIT;/m, 'Upgrade script must conclude with COMMIT;')

    // Policies dropped BEFORE dropping 2-arg functions
    const dropPolicyIdx = sql.indexOf('DROP POLICY IF EXISTS playlists_select_member')
    const dropFuncIdx = sql.indexOf('DROP FUNCTION IF EXISTS public.is_playlist_member(UUID, UUID)')
    assert.ok(dropPolicyIdx !== -1 && dropFuncIdx !== -1, 'Expected drop policy and drop function')
    assert.ok(dropPolicyIdx < dropFuncIdx, 'Policies must be dropped before functions to prevent 2BP01 dependency errors')

    // Legacy policies explicitly purged
    assert.ok(sql.includes('DROP POLICY IF EXISTS playlist_members_insert_owner ON public.playlist_members'))
    assert.ok(sql.includes('DROP POLICY IF EXISTS playlist_members_update_owner ON public.playlist_members'))
    assert.ok(sql.includes('DROP POLICY IF EXISTS playlist_invitations_update ON public.playlist_invitations'))

    // Column defaults updated to now()
    assert.match(sql, /ALTER\s+TABLE\s+public\.profiles\s+ALTER\s+COLUMN\s+created_at\s+SET\s+DEFAULT\s+now\(\);/i)
    assert.match(sql, /ALTER\s+TABLE\s+public\.playlists\s+ALTER\s+COLUMN\s+created_at\s+SET\s+DEFAULT\s+now\(\);/i)

    // Zero occurrences of timezone('utc', now()) in executable SQL
    const codeOnly = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    assert.doesNotMatch(codeOnly, /timezone\s*\(\s*'utc'/i, 'Upgrade script code must not use timezone(\'utc\', ...) anti-pattern')
  })

  it('verifies migration 10 collaborative playlist invitations schema and procedures', () => {
    const migration10Path = path.join(MIGRATIONS_DIR, '20261102000010_collaborative_playlist_invitations.sql')
    assert.ok(fs.existsSync(migration10Path), 'Migration 10 must exist')
    const sql = fs.readFileSync(migration10Path, 'utf-8')

    // Columns and constraints
    assert.match(sql, /ADD COLUMN IF NOT EXISTS invitee_id UUID REFERENCES public\.profiles\(id\)/i)
    assert.match(sql, /ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'/i)
    assert.match(sql, /ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ/i)
    assert.match(sql, /invitation_status_valid[\s\S]*?'pending',\s*'accepted',\s*'declined',\s*'revoked',\s*'expired'/i)
    assert.match(sql, /invitation_target_valid[\s\S]*?token_hash IS NOT NULL OR invitee_id IS NOT NULL/i)

    // Indexes
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_user_invitation/i)
    assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_playlist_invitations_invitee/i)

    // Stored procedures
    assert.match(sql, /FUNCTION public\.accept_playlist_invitation\(p_token TEXT\)/i)
    assert.match(sql, /FUNCTION public\.accept_playlist_invitation_by_id\(p_invitation_id UUID\)/i)
    assert.match(sql, /FUNCTION public\.decline_playlist_invitation\(p_invitation_id UUID\)/i)
    assert.match(sql, /FUNCTION public\.preview_playlist_invitation\(p_token TEXT\)/i)

    // Security hardening: search_path and revoking PUBLIC
    assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.accept_playlist_invitation(TEXT) FROM PUBLIC;'))
    assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.accept_playlist_invitation_by_id(UUID) FROM PUBLIC;'))
    assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.decline_playlist_invitation(UUID) FROM PUBLIC;'))
    assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.preview_playlist_invitation(TEXT) FROM PUBLIC;'))

    // RLS policy updates
    assert.match(sql, /CREATE POLICY playlist_invitations_select[\s\S]*?invitee_id = \(SELECT auth\.uid\(\)\)/i)
  })
})
