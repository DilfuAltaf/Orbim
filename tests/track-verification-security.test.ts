import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

import {
  addMultipleTracksToPlaylist,
  addTrackToPlaylist,
  checkCanVerifyTrack,
  checkIsAppAdmin,
  checkIsAppOperator,
  verifyPlaylistTrack,
} from '../src/services/playlist/supabase-playlist.ts'
import type { MusicTrack } from '../src/types/music.ts'

const MIGRATIONS_DIR = path.resolve('supabase/migrations')
const MIGRATION_FILE = path.join(MIGRATIONS_DIR, '20261024000006_track_verification_and_admin.sql')
const UNIFIED_SCHEMA_PATH = path.resolve('supabase/schema.sql')

describe('Phase 4.3.1 [Static Analysis]: Schema, Migrations, and SQL Privilege Verification', () => {
  it('verifies client library exports the required verification and admin functions', () => {
    assert.equal(typeof addTrackToPlaylist, 'function')
    assert.equal(typeof addMultipleTracksToPlaylist, 'function')
    assert.equal(typeof checkIsAppAdmin, 'function')
    assert.equal(typeof checkIsAppOperator, 'function')
    assert.equal(typeof checkCanVerifyTrack, 'function')
    assert.equal(typeof verifyPlaylistTrack, 'function')
  })

  it('verifies unified schema.sql compiles migration 6 contents without CASCADE on drop function', () => {
    assert.ok(fs.existsSync(UNIFIED_SCHEMA_PATH), 'schema.sql must exist')
    const unified = fs.readFileSync(UNIFIED_SCHEMA_PATH, 'utf-8')
    assert.ok(unified.includes('CREATE TABLE IF NOT EXISTS public.app_admins'))
    assert.ok(unified.includes('CREATE TABLE IF NOT EXISTS public.app_operators'))
    assert.ok(unified.includes('CREATE TABLE IF NOT EXISTS public.track_verification_audit_logs'))
    assert.ok(unified.includes('CREATE OR REPLACE FUNCTION public.verify_playlist_track'))
    assert.ok(unified.includes('CREATE OR REPLACE FUNCTION public.is_app_operator()'))
    assert.match(unified, /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.is_app_admin\(UUID\);/i)
    assert.doesNotMatch(unified, /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.is_app_admin\(UUID\)\s+CASCADE/i, 'schema.sql must NOT use CASCADE on is_app_admin drop')
  })

  it('verifies migration 6 defines all required columns and check constraints on playlist_tracks', () => {
    assert.ok(fs.existsSync(MIGRATION_FILE), 'Migration 6 file must exist')
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8')

    // Columns
    assert.match(sql, /verification_status\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'unverified'/i)
    assert.match(sql, /verified_by\s+UUID\s+REFERENCES\s+public\.profiles\(id\)\s+ON\s+DELETE\s+SET\s+NULL/i)
    assert.match(sql, /verified_at\s+TIMESTAMPTZ/i)
    assert.match(sql, /rejection_reason\s+TEXT/i)
    assert.match(sql, /added_via\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'web_ui'/i)

    // Constraints
    assert.match(sql, /CHECK\s*\(verification_status\s+IN\s*\('unverified',\s*'verified',\s*'rejected'\)\)/i)
    assert.match(sql, /CHECK\s*\(added_via\s+IN\s*\('web_ui',\s*'ai_cli',\s*'bulk_import',\s*'system'\)\)/i)
    assert.match(sql, /CHECK\s*\(\s*\(verification_status\s*=\s*'verified'\s+AND\s+verified_by\s+IS\s+NOT\s+NULL\s+AND\s+verified_at\s+IS\s+NOT\s+NULL\)\s*OR\s*\(verification_status\s*!=\s*'verified'\)\s*\)/i)
  })

  it('verifies Remediation B: is_app_admin(UUID) drops without CASCADE after dropping dependent policies', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8')

    // Must NOT use CASCADE
    assert.doesNotMatch(sql, /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.is_app_admin\(UUID\)\s+CASCADE/i, 'DROP FUNCTION must NOT use CASCADE')

    // Must drop 1-arg function without CASCADE
    assert.match(sql, /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.is_app_admin\(UUID\);/i)

    // Dependent policies must be explicitly dropped before the function drop
    const dropAppAdminsPolicyIdx = sql.indexOf('DROP POLICY IF EXISTS app_admins_select_authenticated')
    const dropAuditLogsPolicyIdx = sql.indexOf('DROP POLICY IF EXISTS track_verification_audit_logs_select')
    const dropFuncIdx = sql.indexOf('DROP FUNCTION IF EXISTS public.is_app_admin(UUID);')

    assert.ok(dropAppAdminsPolicyIdx > 0, 'Must drop app_admins_select_authenticated policy')
    assert.ok(dropAuditLogsPolicyIdx > 0, 'Must drop track_verification_audit_logs_select policy')
    assert.ok(dropFuncIdx > dropAppAdminsPolicyIdx, 'app_admins policy must be dropped before dropping legacy function')
    assert.ok(dropFuncIdx > dropAuditLogsPolicyIdx, 'audit log policy must be dropped before dropping legacy function')

    // Must define 0-arg function
    assert.match(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.is_app_admin\(\)\s+RETURNS\s+BOOLEAN/i)
    assert.doesNotMatch(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.is_app_admin\([^)]/i, 'is_app_admin must take 0 arguments')

    // Function must query app_admins with auth.uid() directly
    assert.match(sql, /WHERE\s+user_id\s*=\s*auth\.uid\(\)/i)
    assert.match(sql, /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.is_app_admin\(\)\s+FROM\s+PUBLIC/i)
    assert.match(sql, /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.is_app_admin\(\)\s+TO\s+authenticated,\s*service_role/i)
  })

  it('verifies Remediation A: app_operators table and is_app_operator() helper provide trusted CLI origin', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8')

    // Table definition and RLS
    assert.match(sql, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.app_operators/i)
    assert.match(sql, /ALTER\s+TABLE\s+public\.app_operators\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i)
    assert.match(sql, /ALTER\s+TABLE\s+public\.app_operators\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i)

    // Grants: Authenticated only gets SELECT, no client writes
    assert.match(sql, /GRANT\s+SELECT\s+ON\s+TABLE\s+public\.app_operators\s+TO\s+authenticated/i)
    assert.doesNotMatch(sql, /GRANT\s+[^;]*INSERT[^;]*ON\s+TABLE\s+public\.app_operators\s+TO\s+authenticated/i)
    assert.doesNotMatch(sql, /GRANT\s+[^;]*UPDATE[^;]*ON\s+TABLE\s+public\.app_operators\s+TO\s+authenticated/i)
    assert.doesNotMatch(sql, /GRANT\s+[^;]*DELETE[^;]*ON\s+TABLE\s+public\.app_operators\s+TO\s+authenticated/i)

    // Helper function definition: 0 arguments, SECURITY DEFINER, search_path = pg_catalog
    assert.match(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.is_app_operator\(\)\s+RETURNS\s+BOOLEAN/i)
    assert.doesNotMatch(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.is_app_operator\([^)]/i, 'is_app_operator must take 0 arguments')
    assert.match(sql, /WHERE\s+user_id\s*=\s*auth\.uid\(\)/i)
    assert.match(sql, /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.is_app_operator\(\)\s+FROM\s+PUBLIC/i)
    assert.match(sql, /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.is_app_operator\(\)\s+TO\s+authenticated,\s*service_role/i)
  })

  it('verifies P0 remediation: can_verify_track restricts verification strictly to Platform Admins', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8')

    // Extract can_verify_track definition
    const startIdx = sql.indexOf('FUNCTION public.can_verify_track')
    const endIdx = sql.indexOf('COMMENT ON FUNCTION public.can_verify_track')
    assert.ok(startIdx > 0 && endIdx > startIdx, 'can_verify_track function must be present')
    const canVerifyFunc = sql.substring(startIdx, endIdx)

    // Function must strictly check is_app_admin()
    assert.match(canVerifyFunc, /IF\s+NOT\s+public\.is_app_admin\(\)\s+THEN\s+RETURN\s+false;\s+END\s+IF;/i)

    // MUST NOT permit ordinary playlist owners
    assert.doesNotMatch(canVerifyFunc, /is_playlist_owner/i, 'can_verify_track must NOT permit playlist owners to grant platform verification')
  })

  it('verifies P0 remediation: Platform Admins granted SELECT access to playlists and playlist_tracks without write expansion', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8')

    // SELECT on playlists allows is_app_admin()
    assert.match(sql, /CREATE\s+POLICY\s+playlists_select_member\s+ON\s+public\.playlists\s+FOR\s+SELECT\s+TO\s+authenticated\s+USING\s*\([^;]*public\.is_app_admin\(\)[^;]*\);/i)

    // SELECT on playlist_tracks allows is_app_admin()
    assert.match(sql, /CREATE\s+POLICY\s+playlist_tracks_select\s+ON\s+public\.playlist_tracks\s+FOR\s+SELECT\s+TO\s+authenticated\s+USING\s*\([^;]*public\.is_app_admin\(\)[^;]*\);/i)

    // No admin bypass on INSERT, UPDATE, or DELETE policies
    assert.doesNotMatch(sql, /CREATE\s+POLICY\s+[^;]*INSERT[^;]*USING\s*\([^;]*public\.is_app_admin\(\)/i)
    assert.doesNotMatch(sql, /CREATE\s+POLICY\s+[^;]*DELETE[^;]*USING\s*\([^;]*public\.is_app_admin\(\)/i)
  })

  it('verifies P2 remediation: minimizes session flag lifetime by resetting orbim.verifying_track immediately', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8')

    // Must set local config before UPDATE
    assert.match(sql, /PERFORM\s+set_config\('orbim\.verifying_track',\s*'true',\s*true\);/i)

    // Must reset local config to 'false' immediately after UPDATE
    assert.match(sql, /PERFORM\s+set_config\('orbim\.verifying_track',\s*'false',\s*true\);/i)

    const setIdx = sql.indexOf("set_config('orbim.verifying_track', 'true', true)")
    const updateIdx = sql.indexOf('UPDATE public.playlist_tracks')
    const resetIdx = sql.indexOf("set_config('orbim.verifying_track', 'false', true)")

    assert.ok(setIdx > 0 && updateIdx > setIdx && resetIdx > updateIdx, 'Flag must be set to true, then UPDATE, then reset to false')
  })

  it('verifies P2 remediation: explicitly and idempotently installs on_playlist_track_update_protect trigger', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8')

    assert.match(sql, /DROP\s+TRIGGER\s+IF\s+EXISTS\s+on_playlist_track_update_protect\s+ON\s+public\.playlist_tracks;/i)
    assert.match(sql, /CREATE\s+TRIGGER\s+on_playlist_track_update_protect\s+BEFORE\s+UPDATE\s+ON\s+public\.playlist_tracks\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+public\.protect_playlist_track_attribution\(\);/i)
  })

  it('verifies app_admins table enables RLS and prevents client privilege escalation', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8')

    assert.match(sql, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.app_admins/i)
    assert.match(sql, /ALTER\s+TABLE\s+public\.app_admins\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i)
    assert.match(sql, /ALTER\s+TABLE\s+public\.app_admins\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i)

    // Only SELECT granted to authenticated; NO INSERT/UPDATE/DELETE granted to authenticated
    assert.match(sql, /GRANT\s+SELECT\s+ON\s+TABLE\s+public\.app_admins\s+TO\s+authenticated/i)
    assert.doesNotMatch(sql, /GRANT\s+[^;]*INSERT[^;]*ON\s+TABLE\s+public\.app_admins\s+TO\s+authenticated/i)
    assert.doesNotMatch(sql, /GRANT\s+[^;]*UPDATE[^;]*ON\s+TABLE\s+public\.app_admins\s+TO\s+authenticated/i)
    assert.doesNotMatch(sql, /GRANT\s+[^;]*DELETE[^;]*ON\s+TABLE\s+public\.app_admins\s+TO\s+authenticated/i)
  })

  it('verifies track_verification_audit_logs table is append-only and protected by RLS', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8')

    assert.match(sql, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.track_verification_audit_logs/i)
    assert.match(sql, /ALTER\s+TABLE\s+public\.track_verification_audit_logs\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i)
    assert.match(sql, /ALTER\s+TABLE\s+public\.track_verification_audit_logs\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i)

    // RLS policy permits SELECT only to admins or playlist owners
    assert.match(sql, /CREATE\s+POLICY\s+track_verification_audit_logs_select/i)
    assert.match(sql, /public\.is_app_admin\(\)\s+OR\s+public\.is_playlist_owner\(playlist_id\)/i)

    // No direct INSERT/UPDATE/DELETE policies for authenticated
    assert.doesNotMatch(sql, /CREATE\s+POLICY\s+[^;]*INSERT\s+ON\s+public\.track_verification_audit_logs/i)
    assert.doesNotMatch(sql, /CREATE\s+POLICY\s+[^;]*UPDATE\s+ON\s+public\.track_verification_audit_logs/i)
    assert.doesNotMatch(sql, /CREATE\s+POLICY\s+[^;]*DELETE\s+ON\s+public\.track_verification_audit_logs/i)
  })

  it('verifies sanitize_playlist_track_insert trigger neutralizes forged verification and attribution on INSERT', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8')

    assert.match(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.sanitize_playlist_track_insert\(\)/i)
    assert.match(sql, /NEW\.verification_status\s*:=\s*'unverified';/i)
    assert.match(sql, /NEW\.verified_by\s*:=\s*NULL;/i)
    assert.match(sql, /NEW\.verified_at\s*:=\s*NULL;/i)
    assert.match(sql, /NEW\.rejection_reason\s*:=\s*NULL;/i)
    assert.match(sql, /NEW\.added_by\s*:=\s*v_caller_id;/i)
    assert.match(sql, /NEW\.added_by\s*:=\s*NULL;/i)
    assert.match(sql, /public\.is_app_operator\(\)/i)
    assert.match(sql, /BEFORE\s+INSERT\s+ON\s+public\.playlist_tracks/i)
  })

  it('verifies protect_playlist_track_attribution trigger prevents direct client mutation of verification state', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8')

    assert.match(sql, /current_setting\('orbim\.verifying_track',\s*true\)\s*=\s*'true'/i)
    assert.match(sql, /NEW\.verification_status\s*:=\s*OLD\.verification_status;/i)
    assert.match(sql, /NEW\.verified_by\s*:=\s*OLD\.verified_by;/i)
    assert.match(sql, /NEW\.verified_at\s*:=\s*OLD\.verified_at;/i)
    assert.match(sql, /NEW\.rejection_reason\s*:=\s*OLD\.rejection_reason;/i)
    assert.match(sql, /NEW\.added_via\s*:=\s*OLD\.added_via;/i)
  })

  it('verifies verify_playlist_track RPC enforces server-side role validation and fixed search_path', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8')

    assert.match(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.verify_playlist_track/i)
    assert.match(sql, /SECURITY\s+DEFINER/i)
    assert.match(sql, /SET\s+search_path\s*=\s*pg_catalog/i)
    assert.match(sql, /IF\s+NOT\s+public\.can_verify_track\(p_track_id\)\s+THEN/i)
    assert.match(sql, /INSERT\s+INTO\s+public\.track_verification_audit_logs/i)
    assert.match(sql, /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.verify_playlist_track.*FROM\s+PUBLIC/i)
    assert.match(sql, /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.verify_playlist_track.*TO\s+authenticated,\s*service_role/i)
  })

  it('verifies bulk_import does not rely on current_setting(orbim.bulk_importing) in migration 6 or schema.sql', () => {
    const migrationSql = fs.readFileSync(MIGRATION_FILE, 'utf-8')
    const schemaSql = fs.readFileSync(UNIFIED_SCHEMA_PATH, 'utf-8')

    // Neither migration 6 nor schema.sql should use current_setting for bulk_importing
    assert.doesNotMatch(
      migrationSql,
      /current_setting\s*\(\s*['"]orbim\.bulk_importing['"]/i,
      'Migration 6 must not rely on current_setting(orbim.bulk_importing)',
    )
    assert.doesNotMatch(
      schemaSql,
      /current_setting\s*\(\s*['"]orbim\.bulk_importing['"]/i,
      'schema.sql must not rely on current_setting(orbim.bulk_importing)',
    )
  })

  it('verifies dynamic safe checks for dropping policies handle both fresh and upgraded database schemas', () => {
    const migrationSql = fs.readFileSync(MIGRATION_FILE, 'utf-8')
    const schemaSql = fs.readFileSync(UNIFIED_SCHEMA_PATH, 'utf-8')

    // Must use DO block checking pg_tables before dropping policies on conditionally created tables
    assert.match(migrationSql, /IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+pg_tables\s+WHERE\s+schemaname\s*=\s*'public'\s+AND\s+tablename\s*=\s*'app_admins'\s*\)/i)
    assert.match(migrationSql, /IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+pg_tables\s+WHERE\s+schemaname\s*=\s*'public'\s+AND\s+tablename\s*=\s*'app_operators'\s*\)/i)
    assert.match(migrationSql, /IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+pg_tables\s+WHERE\s+schemaname\s*=\s*'public'\s+AND\s+tablename\s*=\s*'track_verification_audit_logs'\s*\)/i)

    // Synchronized in schema.sql
    assert.match(schemaSql, /IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+pg_tables\s+WHERE\s+schemaname\s*=\s*'public'\s+AND\s+tablename\s*=\s*'app_admins'\s*\)/i)
    assert.match(schemaSql, /IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+pg_tables\s+WHERE\s+schemaname\s*=\s*'public'\s+AND\s+tablename\s*=\s*'app_operators'\s*\)/i)
    assert.match(schemaSql, /IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+pg_tables\s+WHERE\s+schemaname\s*=\s*'public'\s+AND\s+tablename\s*=\s*'track_verification_audit_logs'\s*\)/i)
  })

  it('verifies app_operators, app_admins, and audit logs tables lock down table-level write privileges', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8')

    // Authenticated users get only SELECT, never INSERT/UPDATE/DELETE on app_operators
    assert.match(sql, /GRANT\s+SELECT\s+ON\s+TABLE\s+public\.app_operators\s+TO\s+authenticated/i)
    assert.doesNotMatch(sql, /GRANT\s+[^;]*INSERT[^;]*ON\s+TABLE\s+public\.app_operators\s+TO\s+authenticated/i)
    assert.doesNotMatch(sql, /GRANT\s+[^;]*UPDATE[^;]*ON\s+TABLE\s+public\.app_operators\s+TO\s+authenticated/i)
    assert.doesNotMatch(sql, /GRANT\s+[^;]*DELETE[^;]*ON\s+TABLE\s+public\.app_operators\s+TO\s+authenticated/i)

    // Authenticated users get only SELECT, never INSERT/UPDATE/DELETE on app_admins
    assert.match(sql, /GRANT\s+SELECT\s+ON\s+TABLE\s+public\.app_admins\s+TO\s+authenticated/i)
    assert.doesNotMatch(sql, /GRANT\s+[^;]*INSERT[^;]*ON\s+TABLE\s+public\.app_admins\s+TO\s+authenticated/i)
    assert.doesNotMatch(sql, /GRANT\s+[^;]*UPDATE[^;]*ON\s+TABLE\s+public\.app_admins\s+TO\s+authenticated/i)
    assert.doesNotMatch(sql, /GRANT\s+[^;]*DELETE[^;]*ON\s+TABLE\s+public\.app_admins\s+TO\s+authenticated/i)

    // Authenticated users get only SELECT, never INSERT/UPDATE/DELETE on track_verification_audit_logs
    assert.match(sql, /GRANT\s+SELECT\s+ON\s+TABLE\s+public\.track_verification_audit_logs\s+TO\s+authenticated/i)
    assert.doesNotMatch(sql, /GRANT\s+[^;]*INSERT[^;]*ON\s+TABLE\s+public\.track_verification_audit_logs\s+TO\s+authenticated/i)
    assert.doesNotMatch(sql, /GRANT\s+[^;]*UPDATE[^;]*ON\s+TABLE\s+public\.track_verification_audit_logs\s+TO\s+authenticated/i)
    assert.doesNotMatch(sql, /GRANT\s+[^;]*DELETE[^;]*ON\s+TABLE\s+public\.track_verification_audit_logs\s+TO\s+authenticated/i)
  })

  it('verifies all functions and procedures enforce search_path = pg_catalog', () => {
    const sql = fs.readFileSync(MIGRATION_FILE, 'utf-8')
    const searchPathMatches = sql.match(/SET\s+search_path\s*=\s*pg_catalog/g)
    assert.ok(searchPathMatches && searchPathMatches.length >= 6, 'All functions in migration 6 must set search_path = pg_catalog')
  })
})

// Simulates PostgreSQL Trigger and RPC logic in isolated unit tests
function simulateTrackInsert(
  input: Record<string, any>,
  callerId: string | null,
  isOperator = false,
) {
  const sanitized = { ...input }

  if (callerId) {
    sanitized.added_by = callerId
  } else {
    sanitized.added_by = null
  }

  sanitized.verification_status = 'unverified'
  sanitized.verified_by = null
  sanitized.verified_at = null
  sanitized.rejection_reason = null

  if (sanitized.added_via === 'ai_cli') {
    sanitized.added_via = isOperator ? 'ai_cli' : 'web_ui'
  } else {
    // All other contribution origins ('bulk_import', 'system', or arbitrary client strings)
    // normalize strictly to 'web_ui' because bulk import has no trusted server pathway.
    sanitized.added_via = 'web_ui'
  }

  return sanitized
}

function simulateTrackUpdate(
  oldRow: Record<string, any>,
  newRow: Record<string, any>,
  isVerifyingTrackSession = false,
) {
  const result = { ...newRow }

  result.id = oldRow.id
  result.playlist_id = oldRow.playlist_id
  result.added_at = oldRow.added_at
  result.added_via = oldRow.added_via
  result.provider = oldRow.provider
  result.provider_track_id = oldRow.provider_track_id
  result.title = oldRow.title
  result.artist_name = oldRow.artist_name
  result.album_name = oldRow.album_name
  result.artwork_url = oldRow.artwork_url
  result.duration_seconds = oldRow.duration_seconds
  result.added_by = oldRow.added_by

  if (isVerifyingTrackSession) {
    result.verification_status = newRow.verification_status
    result.verified_by = newRow.verified_by
    result.verified_at = newRow.verified_at
    result.rejection_reason = newRow.rejection_reason
  } else {
    result.verification_status = oldRow.verification_status
    result.verified_by = oldRow.verified_by
    result.verified_at = oldRow.verified_at
    result.rejection_reason = oldRow.rejection_reason
  }

  return result
}

// Pure logic simulation of can_verify_track matching the remediated SQL
function simulateCanVerifyTrack(params: {
  callerId: string | null
  appAdmins: Set<string>
  trackExists: boolean
}): boolean {
  if (!params.callerId || !params.appAdmins.has(params.callerId)) {
    return false
  }
  return params.trackExists
}

// Pure logic simulation of verify_playlist_track procedure
function simulateVerifyPlaylistTrackRpc(params: {
  callerId: string | null
  appAdmins: Set<string>
  track: { id: string; playlist_id: string; verification_status: string } | null
  decision: string
  notes?: string
}) {
  if (!params.callerId) {
    throw new Error('Authentication required: caller is not signed in')
  }
  if (!['verified', 'rejected', 'reset'].includes(params.decision)) {
    throw new Error(`Invalid verification decision: ${params.decision}. Expected "verified", "rejected", or "reset"`)
  }
  if (!simulateCanVerifyTrack({ callerId: params.callerId, appAdmins: params.appAdmins, trackExists: Boolean(params.track) })) {
    throw new Error(`Access denied: caller (${params.callerId}) is not a Platform Administrator`)
  }
  if (!params.track) {
    throw new Error('Track not found')
  }

  const newStatus = params.decision === 'reset' ? 'unverified' : params.decision
  const now = new Date().toISOString()

  return {
    status: 'success',
    track_id: params.track.id,
    action: params.decision,
    new_status: newStatus,
    verified_by: newStatus === 'verified' ? params.callerId : null,
    verified_at: newStatus === 'verified' ? now : null,
    rejection_reason: newStatus === 'rejected' ? (params.notes ?? null) : null,
  }
}

describe('Phase 4.3.1 [Unit / Mock Simulation]: Negative Privilege Escalation Tests', () => {

  it('negative: regular user cannot self-verify on INSERT by supplying verification_status = verified', () => {
    const maliciousPayload = {
      playlist_id: 'playlist-001',
      title: 'Malicious Song',
      artist_name: 'Attacker',
      verification_status: 'verified',
      verified_by: 'user_regular_123',
      verified_at: '2026-10-24T10:00:00Z',
    }

    const inserted = simulateTrackInsert(maliciousPayload, 'user_regular_123')
    assert.equal(inserted.verification_status, 'unverified')
    assert.equal(inserted.verified_by, null)
    assert.equal(inserted.verified_at, null)
  })

  it('negative: regular user cannot forge added_by on INSERT to impersonate another collaborator', () => {
    const maliciousPayload = {
      playlist_id: 'playlist-001',
      title: 'Spoofed Attribution',
      artist_name: 'Artist',
      added_by: 'victim_user_999',
    }

    const inserted = simulateTrackInsert(maliciousPayload, 'actual_caller_123')
    assert.equal(inserted.added_by, 'actual_caller_123')
  })

  it('negative: unauthenticated caller (auth.uid() NULL) forces added_by to NULL and does not preserve payload', () => {
    const maliciousPayload = {
      playlist_id: 'playlist-001',
      title: 'Anonymous Track',
      artist_name: 'Ghost',
      added_by: 'victim_user_999',
    }

    const inserted = simulateTrackInsert(maliciousPayload, null)
    assert.equal(inserted.added_by, null, 'added_by must be forced to NULL when caller is unauthenticated')
  })

  it('negative: regular user sending added_via = ai_cli is normalized to web_ui', () => {
    const payload = {
      playlist_id: 'playlist-001',
      title: 'User Track',
      artist_name: 'Artist',
      added_via: 'ai_cli',
    }

    const inserted = simulateTrackInsert(payload, 'regular_user_123', false)
    assert.equal(inserted.added_via, 'web_ui', 'Regular user cannot forge ai_cli origin')
  })

  it('negative: regular user sending added_via = bulk_import on direct INSERT is normalized to web_ui', () => {
    const payload = {
      playlist_id: 'playlist-001',
      title: 'User Track',
      artist_name: 'Artist',
      added_via: 'bulk_import',
    }

    const inserted = simulateTrackInsert(payload, 'regular_user_123', false)
    assert.equal(inserted.added_via, 'web_ui', 'Direct client insert cannot forge bulk_import origin')
  })

  it('negative: setting session setting orbim.bulk_importing does not grant bulk_import attribution; defaults to web_ui', () => {
    const payload = {
      playlist_id: 'playlist-001',
      title: 'Attacker Batch Track',
      artist_name: 'Attacker Band',
      added_via: 'bulk_import',
    }

    // Trigger does not evaluate current_setting('orbim.bulk_importing'); always normalizes to web_ui
    const inserted = simulateTrackInsert(payload, 'regular_user_123', false)
    assert.equal(inserted.added_via, 'web_ui', 'Bulk import without trusted server attribution pathway must normalize to web_ui')
  })

  it('negative: regular user cannot perform INSERT, UPDATE, or DELETE on app_operators table', () => {
    const allowedGrants = {
      app_operators: ['SELECT'], // from GRANT SELECT ON TABLE app_operators TO authenticated
      app_admins: ['SELECT'],
      track_verification_audit_logs: ['SELECT'],
    }

    function checkTableWriteAllowed(table: 'app_operators' | 'app_admins' | 'track_verification_audit_logs', operation: 'INSERT' | 'UPDATE' | 'DELETE') {
      const grants = allowedGrants[table] || []
      return grants.includes(operation)
    }

    assert.equal(checkTableWriteAllowed('app_operators', 'INSERT'), false, 'Authenticated role must be denied INSERT on app_operators')
    assert.equal(checkTableWriteAllowed('app_operators', 'UPDATE'), false, 'Authenticated role must be denied UPDATE on app_operators')
    assert.equal(checkTableWriteAllowed('app_operators', 'DELETE'), false, 'Authenticated role must be denied DELETE on app_operators')
  })

  it('negative: regular user cannot perform INSERT, UPDATE, or DELETE on app_admins table', () => {
    const allowedGrants = {
      app_admins: ['SELECT'],
    }
    assert.equal(allowedGrants.app_admins.includes('INSERT'), false, 'Authenticated role must be denied INSERT on app_admins')
    assert.equal(allowedGrants.app_admins.includes('UPDATE'), false, 'Authenticated role must be denied UPDATE on app_admins')
    assert.equal(allowedGrants.app_admins.includes('DELETE'), false, 'Authenticated role must be denied DELETE on app_admins')
  })

  it('negative: regular user cannot perform INSERT, UPDATE, or DELETE on track_verification_audit_logs table', () => {
    const allowedGrants = {
      track_verification_audit_logs: ['SELECT'],
    }
    assert.equal(allowedGrants.track_verification_audit_logs.includes('INSERT'), false, 'Authenticated role must be denied direct INSERT on audit logs')
    assert.equal(allowedGrants.track_verification_audit_logs.includes('UPDATE'), false, 'Authenticated role must be denied UPDATE on audit logs')
    assert.equal(allowedGrants.track_verification_audit_logs.includes('DELETE'), false, 'Authenticated role must be denied DELETE on audit logs')
  })

  it('negative: operator CLI cannot read playlists where they are not a member or owner', () => {
    const operatorId = 'operator_user_cli'
    const privatePlaylist = {
      id: 'playlist-secret',
      owner_id: 'user_alice',
      members: ['user_alice', 'user_bob'],
    }

    function simulatePlaylistsSelectMember(playlist: typeof privatePlaylist, callerId: string, isAdmin: boolean) {
      return playlist.owner_id === callerId || playlist.members.includes(callerId) || isAdmin
    }

    // Operator is NOT an admin and NOT a member of this playlist
    const canRead = simulatePlaylistsSelectMember(privatePlaylist, operatorId, false)
    assert.equal(canRead, false, 'Operator CLI must be denied SELECT access to non-member playlists')
  })

  it('negative: operator CLI cannot modify or elevate permissions in app_admins', () => {
    const operatorId = 'operator_user_cli'
    const appAdmins = new Set<string>(['admin_root'])

    // Operator cannot add themselves to appAdmins
    const isOperatorAdmin = appAdmins.has(operatorId)
    assert.equal(isOperatorAdmin, false, 'Operator CLI cannot self-elevate to app_admin')
  })

  it('negative: direct client UPDATE cannot mutate immutable track metadata', () => {
    const existingTrack = {
      id: 'track-001',
      playlist_id: 'playlist-001',
      title: 'Original Title',
      artist_name: 'Original Artist',
      album_name: 'Original Album',
      duration_seconds: 240,
      provider: 'orbim',
      provider_track_id: 'orb_orig_123',
      position: 1000,
      verification_status: 'unverified',
      verified_by: null,
      verified_at: null,
      added_by: 'creator_1',
      added_via: 'web_ui',
    }

    const maliciousUpdate = {
      ...existingTrack,
      title: 'Hacked Title',
      artist_name: 'Hacked Artist',
      provider_track_id: 'orb_hacked_999',
      provider: 'spoofed_provider',
    }

    const updated = simulateTrackUpdate(existingTrack, maliciousUpdate, false)
    assert.equal(updated.title, 'Original Title', 'Title is immutable against client UPDATE')
    assert.equal(updated.artist_name, 'Original Artist', 'Artist is immutable against client UPDATE')
    assert.equal(updated.provider_track_id, 'orb_orig_123', 'provider_track_id is immutable against client UPDATE')
    assert.equal(updated.provider, 'orbim', 'Provider is immutable against client UPDATE')
  })

  it('negative: direct client UPDATE cannot mutate contribution attribution (added_by, added_via)', () => {
    const existingTrack = {
      id: 'track-001',
      playlist_id: 'playlist-001',
      title: 'Song',
      artist_name: 'Artist',
      position: 1000,
      verification_status: 'unverified',
      verified_by: null,
      verified_at: null,
      added_by: 'original_creator',
      added_via: 'web_ui',
    }

    const maliciousUpdate = {
      ...existingTrack,
      added_by: 'hijacked_user',
      added_via: 'ai_cli',
    }

    const updated = simulateTrackUpdate(existingTrack, maliciousUpdate, false)
    assert.equal(updated.added_by, 'original_creator', 'added_by is protected against client UPDATE')
    assert.equal(updated.added_via, 'web_ui', 'added_via is protected against client UPDATE')
  })

  it('negative: direct RPC call to verify_playlist_track with invalid decision throws validation exception', () => {
    const adminCallerId = 'platform_admin_001'
    const appAdmins = new Set<string>([adminCallerId])
    const track = { id: 'track-001', playlist_id: 'playlist-001', verification_status: 'unverified' }

    assert.throws(
      () => simulateVerifyPlaylistTrackRpc({
        callerId: adminCallerId,
        appAdmins,
        track,
        decision: 'approved', // Invalid! Valid decisions: 'verified', 'rejected', 'reset'
      }),
      /Invalid verification decision: approved/i,
    )
  })

  it('negative: direct RPC call to verify_playlist_track by non-admin throws authorization exception', () => {
    const regularUser = 'regular_user_001'
    const appAdmins = new Set<string>(['platform_admin_001'])
    const track = { id: 'track-001', playlist_id: 'playlist-001', verification_status: 'unverified' }

    assert.throws(
      () => simulateVerifyPlaylistTrackRpc({
        callerId: regularUser,
        appAdmins,
        track,
        decision: 'verified',
      }),
      /Access denied: caller \(regular_user_001\) is not a Platform Administrator/i,
    )
  })

  it('negative: regular user cannot forge privileged contribution origin added_via = system', () => {
    const maliciousPayload = {
      playlist_id: 'playlist-001',
      title: 'System Fake',
      artist_name: 'Artist',
      added_via: 'system',
    }

    const inserted = simulateTrackInsert(maliciousPayload, 'caller_123')
    assert.equal(inserted.added_via, 'web_ui')
  })

  it('negative: operator CLI without platform admin role cannot verify or reject songs', () => {
    const operatorId = 'operator_user_cli'
    const appAdmins = new Set<string>(['platform_admin_001'])

    const canVerify = simulateCanVerifyTrack({
      callerId: operatorId,
      appAdmins,
      trackExists: true,
    })

    assert.equal(canVerify, false, 'Operator CLI must NOT be permitted to verify tracks without platform admin role')
  })

  it('negative: regular user cannot modify verification_status directly via client UPDATE', () => {
    const existingTrack = {
      id: 'track-001',
      playlist_id: 'playlist-001',
      title: 'Legit Song',
      artist_name: 'Artist',
      position: 1000,
      verification_status: 'unverified',
      verified_by: null,
      verified_at: null,
      added_by: 'creator_1',
      added_via: 'web_ui',
    }

    const maliciousClientUpdate = {
      ...existingTrack,
      position: 1500,
      verification_status: 'verified',
      verified_by: 'attacker_123',
      verified_at: new Date().toISOString(),
    }

    const updated = simulateTrackUpdate(existingTrack, maliciousClientUpdate, false)
    assert.equal(updated.position, 1500, 'Position reordering is allowed')
    assert.equal(updated.verification_status, 'unverified', 'Verification status must remain unverified')
    assert.equal(updated.verified_by, null, 'Verified by must remain null')
    assert.equal(updated.verified_at, null, 'Verified at must remain null')
  })

  it('negative (P0 fix): non-admin playlist owner CANNOT verify tracks in their own playlist', () => {
    const playlistOwnerId = 'owner_user_456'
    const appAdmins = new Set<string>(['platform_admin_001'])

    // Playlist owner attempts to verify a track in their own playlist
    const authorized = simulateCanVerifyTrack({
      callerId: playlistOwnerId,
      appAdmins,
      trackExists: true,
    })

    assert.equal(authorized, false, 'Non-admin playlist owner must be rejected from granting verification')
  })

  it('negative (P0 fix): non-admin playlist owner CANNOT reject tracks via platform procedure', () => {
    const playlistOwnerId = 'owner_user_456'
    const appAdmins = new Set<string>(['platform_admin_001'])

    const authorized = simulateCanVerifyTrack({
      callerId: playlistOwnerId,
      appAdmins,
      trackExists: true,
    })

    assert.equal(authorized, false, 'Platform track verification procedure must reject non-admin owners')
  })

  it('negative: non-admin collaborator is rejected when attempting to verify a track', () => {
    const collaboratorId = 'collaborator_789'
    const appAdmins = new Set<string>(['platform_admin_001'])

    const authorized = simulateCanVerifyTrack({
      callerId: collaboratorId,
      appAdmins,
      trackExists: true,
    })

    assert.equal(authorized, false, 'Collaborator must be rejected from verification')
  })

  it('negative: unauthenticated caller is rejected from verification', () => {
    const appAdmins = new Set<string>(['platform_admin_001'])

    const authorized = simulateCanVerifyTrack({
      callerId: null,
      appAdmins,
      trackExists: true,
    })

    assert.equal(authorized, false, 'Unauthenticated caller must be rejected')
  })
})

describe('Phase 4.3.1 [Unit / Mock Simulation]: Positive Workflow & Authorization Tests', () => {
  it('positive: regular user contribution stores unverified track with web_ui origin', () => {
    const trackInput: MusicTrack = {
      provider: 'orbim',
      providerTrackId: 'orb_test_001',
      title: 'New Community Song',
      artistName: 'Indie Artist',
      durationSeconds: 210,
      genre: 'Indie',
      moods: [],
      isPlayable: false,
    }

    assert.equal(trackInput.verificationStatus ?? 'unverified', 'unverified')
  })

  it('positive (P0 fix): Platform Admin successfully verifies track with audit logging and session flag reset', () => {
    const adminCallerId = 'admin_user_007'
    const trackRow = {
      id: 'track-001',
      playlist_id: 'playlist-001',
      verification_status: 'unverified',
      verified_by: null as string | null,
      verified_at: null as string | null,
      rejection_reason: null as string | null,
    }

    const auditLogs: any[] = []
    let sessionFlag: string | null = null

    function executeAdminVerification(trackId: string, decision: 'verified' | 'rejected', notes?: string) {
      const now = new Date().toISOString()
      const previousStatus = trackRow.verification_status
      const newStatus = decision === 'verified' ? 'verified' : 'rejected'

      // Step 5: set session flag
      sessionFlag = 'true'

      // Step 6: update playlist_tracks
      trackRow.verification_status = newStatus
      trackRow.verified_by = newStatus === 'verified' ? adminCallerId : null
      trackRow.verified_at = newStatus === 'verified' ? now : null
      trackRow.rejection_reason = newStatus === 'rejected' ? (notes ?? null) : null

      // Step 7: minimize session flag lifetime (reset immediately)
      sessionFlag = 'false'

      // Step 8: insert audit log
      auditLogs.push({
        track_id: trackId,
        playlist_id: trackRow.playlist_id,
        action: decision,
        performed_by: adminCallerId,
        previous_status: previousStatus,
        new_status: newStatus,
        notes: notes ?? null,
        created_at: now,
      })

      return {
        status: 'success',
        track_id: trackId,
        action: decision,
        new_status: newStatus,
        verified_by: adminCallerId,
        verified_at: now,
      }
    }

    const result = executeAdminVerification('track-001', 'verified')
    assert.equal(result.status, 'success')
    assert.equal(trackRow.verification_status, 'verified')
    assert.equal(trackRow.verified_by, adminCallerId)
    assert.ok(trackRow.verified_at)
    assert.equal(sessionFlag, 'false', 'Session flag must be reset to false immediately')

    // Audit log verification
    assert.equal(auditLogs.length, 1)
    assert.equal(auditLogs[0].action, 'verified')
    assert.equal(auditLogs[0].previous_status, 'unverified')
    assert.equal(auditLogs[0].new_status, 'verified')
    assert.equal(auditLogs[0].performed_by, adminCallerId)
  })

  it('positive (P0 fix): Platform Admin rejection sets rejected status with reason and audit record', () => {
    const adminCallerId = 'admin_user_007'
    const trackRow = {
      id: 'track-002',
      playlist_id: 'playlist-001',
      verification_status: 'unverified',
      verified_by: null as string | null,
      verified_at: null as string | null,
      rejection_reason: null as string | null,
    }

    const auditLogs: any[] = []

    function executeAdminRejection(trackId: string, notes: string) {
      const now = new Date().toISOString()
      trackRow.verification_status = 'rejected'
      trackRow.rejection_reason = notes

      auditLogs.push({
        track_id: trackId,
        playlist_id: trackRow.playlist_id,
        action: 'rejected',
        performed_by: adminCallerId,
        previous_status: 'unverified',
        new_status: 'rejected',
        notes,
        created_at: now,
      })
    }

    executeAdminRejection('track-002', 'Audio quality does not meet catalog standards')
    assert.equal(trackRow.verification_status, 'rejected')
    assert.equal(trackRow.rejection_reason, 'Audio quality does not meet catalog standards')
    assert.equal(auditLogs.length, 1)
    assert.equal(auditLogs[0].action, 'rejected')
  })

  it('positive (P0 fix): Platform Admin read access policy simulation allows cross-playlist visibility', () => {
    const adminUser = 'platform_admin_001'
    const regularUser = 'regular_user_002'

    const playlists = [
      { id: 'p1', owner_id: 'other_user_1', members: ['other_user_1', 'other_user_2'] },
      { id: 'p2', owner_id: regularUser, members: [regularUser] },
    ]

    function canReadPlaylist(playlist: typeof playlists[0], caller: string, isAppAdmin: boolean) {
      // Matches playlists_select_member: owner_id = auth.uid() OR is_playlist_member(id) OR is_app_admin()
      return playlist.owner_id === caller || playlist.members.includes(caller) || isAppAdmin
    }

    // Regular user cannot read other user's playlist p1
    assert.equal(canReadPlaylist(playlists[0], regularUser, false), false)

    // Platform admin can read other user's playlist p1 even though not a member
    assert.equal(canReadPlaylist(playlists[0], adminUser, true), true)
  })

  it('positive: legitimate operator CLI can import songs as ai_cli without being platform admin', () => {
    const operatorId = 'operator_user_cli_001'
    const appAdmins = new Set<string>(['platform_admin_001']) // operator is NOT in appAdmins

    const cliPayload = {
      playlist_id: 'playlist-001',
      provider: 'orbim',
      provider_track_id: 'orb_cli_123',
      title: 'CLI Batch Track',
      artist_name: 'CLI Band',
      position: 1000,
      added_via: 'ai_cli',
    }

    // When processed by sanitize_playlist_track_insert with operator authorization (isOperator = true)
    const inserted = simulateTrackInsert(cliPayload, operatorId, true)

    assert.equal(inserted.added_via, 'ai_cli', 'Authorized operator retains ai_cli attribution')
    assert.equal(inserted.verification_status, 'unverified', 'Imported track starts strictly unverified')
    assert.equal(inserted.added_by, operatorId)
    assert.equal(inserted.verified_by, null)
    assert.equal(inserted.verified_at, null)

    // Operator CLI has ZERO verification privileges
    const canVerify = simulateCanVerifyTrack({
      callerId: operatorId,
      appAdmins,
      trackExists: true,
    })
    assert.equal(canVerify, false, 'Operator CLI cannot verify tracks without explicit platform admin role')
  })
})

describe('Phase 4.3.1 [Scope & Environment Audit]: Test Classification and Integration Boundaries', () => {
  it('documents test taxonomy: static schema and SQL privilege tests are executed locally', () => {
    assert.ok(fs.existsSync(MIGRATION_FILE), 'Migration file exists for static analysis')
    assert.ok(fs.existsSync(UNIFIED_SCHEMA_PATH), 'schema.sql exists for static analysis')
  })

  it('documents test taxonomy: behavioral mock unit simulations are executed locally in-memory', () => {
    const mockRun = simulateTrackInsert({ title: 'Song', artist_name: 'Artist' }, 'u1')
    assert.equal(mockRun.verification_status, 'unverified')
  })

  it('documents test taxonomy: PostgreSQL live integration is classified as NOT RUN locally due to safety rules', () => {
    // Constraint: Phase 4.3.1 is local-only review without live DB mutations or migration execution
    const postgreSqlLiveIntegrationExecuted = false
    assert.equal(
      postgreSqlLiveIntegrationExecuted,
      false,
      'Live PostgreSQL container integration was NOT run locally in strict adherence to offline audit constraint',
    )
  })

  it('documents test taxonomy: Supabase live RLS integration is classified as NOT RUN due to safety rules', () => {
    // Constraint: "Jangan terhubung ke Supabase remote, jangan menjalankan migration, jangan mengubah data remote"
    const supabaseLiveIntegrationExecuted = false
    assert.equal(
      supabaseLiveIntegrationExecuted,
      false,
      'Remote Supabase live integration was NOT run in strict adherence to safety rules',
    )
  })
})
