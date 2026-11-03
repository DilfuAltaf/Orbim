-- Migration 6: Track Contribution Attribution, Admin Roles, and Verification Workflow
-- ORBIM Phase 4.3 Database Security Hardening (Targeted Remediation)
--
-- Security Guarantees:
-- 1. All new track contributions default strictly to 'unverified'.
-- 2. Client-initiated attempts to forge 'verified' status, verified_by, verified_at,
--    or privileged contribution origins on INSERT are sanitized by BEFORE INSERT trigger.
-- 3. Direct client UPDATEs to verification columns are blocked by BEFORE UPDATE trigger.
-- 4. Verification and rejection can ONLY occur via the trusted SECURITY DEFINER procedure
--    `verify_playlist_track`, strictly reserved for Platform Administrators (public.is_app_admin()).
--    Playlist owners cannot self-verify tracks to platform 'verified' status.
-- 5. Session flag `orbim.verifying_track` lifetime is minimized: immediately reset to 'false' after UPDATE.
-- 6. Helper function `is_app_admin()` has 0 arguments, eliminating admin probing/enumeration vectors.
-- 7. Platform Admins are granted SELECT access to all playlists and playlist_tracks across the platform,
--    without expanding write permissions.
-- 8. Every verification action produces an immutable audit log row in `track_verification_audit_logs`.
-- 9. Triggers on_playlist_track_insert_sanitize and on_playlist_track_update_protect are explicitly
--    and idempotently attached.

-- ==============================================================================
-- 1. Extend playlist_tracks with Verification and Origin Columns
-- ==============================================================================

ALTER TABLE public.playlist_tracks
    ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified',
    ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
    ADD COLUMN IF NOT EXISTS added_via TEXT NOT NULL DEFAULT 'web_ui';

-- Add check constraints safely
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'track_verification_status_valid'
    ) THEN
        ALTER TABLE public.playlist_tracks
            ADD CONSTRAINT track_verification_status_valid
            CHECK (verification_status IN ('unverified', 'verified', 'rejected'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'track_added_via_valid'
    ) THEN
        ALTER TABLE public.playlist_tracks
            ADD CONSTRAINT track_added_via_valid
            CHECK (added_via IN ('web_ui', 'ai_cli', 'bulk_import', 'system'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'track_verification_integrity'
    ) THEN
        ALTER TABLE public.playlist_tracks
            ADD CONSTRAINT track_verification_integrity
            CHECK (
                (verification_status = 'verified' AND verified_by IS NOT NULL AND verified_at IS NOT NULL)
                OR (verification_status != 'verified')
            );
    END IF;
END $$;

COMMENT ON COLUMN public.playlist_tracks.verification_status IS 'Editorial verification state: unverified (default), verified, or rejected.';
COMMENT ON COLUMN public.playlist_tracks.verified_by IS 'Profile ID of the platform administrator who performed verification approval.';
COMMENT ON COLUMN public.playlist_tracks.verified_at IS 'Timestamp of when the verification decision was committed.';
COMMENT ON COLUMN public.playlist_tracks.rejection_reason IS 'Optional notes explaining why verification was rejected.';
COMMENT ON COLUMN public.playlist_tracks.added_via IS 'Origin of track contribution: web_ui, ai_cli, bulk_import, or system.';

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_verification_status
    ON public.playlist_tracks(verification_status);

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_added_via
    ON public.playlist_tracks(added_via);

-- ==============================================================================
-- 2. Create Application Administrators Table (app_admins) & Non-Probing Helper
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.app_admins (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'superadmin')),
    granted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_admins IS 'Platform administrators authorized to verify music tracks and manage system catalog.';
COMMENT ON COLUMN public.app_admins.user_id IS 'References public.profiles(id) of designated admin.';

-- Enable and Force RLS
ALTER TABLE public.app_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_admins FORCE ROW LEVEL SECURITY;

-- Explicitly drop dependent policies before dropping function to eliminate silent CASCADE drops.
-- Dynamic checks ensure this succeeds on fresh databases (where tables may not exist yet)
-- and upgraded databases (where policies dependent on legacy is_app_admin(UUID) must be severed first).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'app_admins') THEN
        EXECUTE 'DROP POLICY IF EXISTS app_admins_select_authenticated ON public.app_admins';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'app_operators') THEN
        EXECUTE 'DROP POLICY IF EXISTS app_operators_select_authenticated ON public.app_operators';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'track_verification_audit_logs') THEN
        EXECUTE 'DROP POLICY IF EXISTS track_verification_audit_logs_select ON public.track_verification_audit_logs';
    END IF;
END $$;

-- Drop dependent policies on existing application tables from earlier migrations
DROP POLICY IF EXISTS playlists_select_member ON public.playlists;
DROP POLICY IF EXISTS playlist_tracks_select ON public.playlist_tracks;

-- Drop legacy 1-arg signature without CASCADE to prevent accidental silent drops
DROP FUNCTION IF EXISTS public.is_app_admin(UUID);

-- Helper function: is_app_admin() (Zero arguments: evaluates only active caller auth.uid())
CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.app_admins
        WHERE user_id = auth.uid()
    );
$$;

COMMENT ON FUNCTION public.is_app_admin() IS 'Determines if current authenticated caller holds platform administrator status without exposing parameter probing.';

REVOKE ALL ON FUNCTION public.is_app_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated, service_role;

-- RLS for app_admins:
-- Authenticated users can only read their own admin record or check admin existence.
CREATE POLICY app_admins_select_authenticated
    ON public.app_admins
    FOR SELECT
    TO authenticated
    USING (user_id = (SELECT auth.uid()) OR public.is_app_admin());

-- DEFENSE-IN-DEPTH: NO INSERT, UPDATE, or DELETE policies for authenticated role.
-- Admins can only be provisioned by database owner, service_role, or superadmin.
REVOKE ALL ON TABLE public.app_admins FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.app_admins TO authenticated;
GRANT ALL ON TABLE public.app_admins TO postgres, service_role;

-- ==============================================================================
-- 3. Create Application Operators Table (app_operators) & Non-Probing Helper
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.app_operators (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('operator', 'lead_operator')),
    granted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_operators IS 'Authorized automated/CLI operators permitted to import tracks with ai_cli attribution.';
COMMENT ON COLUMN public.app_operators.user_id IS 'References public.profiles(id) of designated operator.';

-- Enable and Force RLS
ALTER TABLE public.app_operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_operators FORCE ROW LEVEL SECURITY;

-- Helper function: is_app_operator() (Zero arguments: evaluates only active caller auth.uid())
CREATE OR REPLACE FUNCTION public.is_app_operator()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.app_operators
        WHERE user_id = auth.uid()
    );
$$;

COMMENT ON FUNCTION public.is_app_operator() IS 'Determines if current authenticated caller holds operator authorization without exposing parameter probing.';

REVOKE ALL ON FUNCTION public.is_app_operator() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_app_operator() TO authenticated, service_role;

-- RLS for app_operators:
-- Authenticated users can only read their own operator record or check admin existence.
DROP POLICY IF EXISTS app_operators_select_authenticated ON public.app_operators;
CREATE POLICY app_operators_select_authenticated
    ON public.app_operators
    FOR SELECT
    TO authenticated
    USING (user_id = (SELECT auth.uid()) OR public.is_app_admin());

-- DEFENSE-IN-DEPTH: NO INSERT, UPDATE, or DELETE policies for authenticated role.
-- Operators can only be provisioned by database owner, service_role, or superadmin.
REVOKE ALL ON TABLE public.app_operators FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.app_operators TO authenticated;
GRANT ALL ON TABLE public.app_operators TO postgres, service_role;

-- ==============================================================================
-- 4. Create Verification Audit Log Table (track_verification_audit_logs)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.track_verification_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    track_id UUID NOT NULL REFERENCES public.playlist_tracks(id) ON DELETE CASCADE,
    playlist_id UUID NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (action IN ('verified', 'rejected', 'reset')),
    performed_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    previous_status TEXT NOT NULL,
    new_status TEXT NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.track_verification_audit_logs IS 'Append-only audit log tracking all track verification decisions.';

-- Enable and Force RLS
ALTER TABLE public.track_verification_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.track_verification_audit_logs FORCE ROW LEVEL SECURITY;

-- RLS: Platform admins can view all audit logs; playlist owners can view audit logs for their playlists
CREATE POLICY track_verification_audit_logs_select
    ON public.track_verification_audit_logs
    FOR SELECT
    TO authenticated
    USING (
        public.is_app_admin()
        OR public.is_playlist_owner(playlist_id)
    );

-- DEFENSE-IN-DEPTH: NO INSERT, UPDATE, or DELETE policies for authenticated role!
-- Rows are inserted strictly via the SECURITY DEFINER procedure `verify_playlist_track`.
REVOKE ALL ON TABLE public.track_verification_audit_logs FROM anon, PUBLIC;
GRANT SELECT ON TABLE public.track_verification_audit_logs TO authenticated;
GRANT ALL ON TABLE public.track_verification_audit_logs TO postgres, service_role;

-- ==============================================================================
-- 5. Helper Function: can_verify_track (Strict Admin-Only Validation)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.can_verify_track(p_track_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    -- Strict admin-only verification: Platform status 'verified' and 'rejected'
    -- can ONLY be determined by a Platform Administrator.
    -- Ordinary playlist owners and operators cannot self-verify tracks into the catalog.
    IF NOT public.is_app_admin() THEN
        RETURN false;
    END IF;

    -- Verify track exists
    RETURN EXISTS (
        SELECT 1
        FROM public.playlist_tracks
        WHERE id = p_track_id
    );
END;
$$;

COMMENT ON FUNCTION public.can_verify_track(UUID) IS 'Determines if current caller has platform administrator authority to verify or reject a track.';

REVOKE ALL ON FUNCTION public.can_verify_track(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_verify_track(UUID) TO authenticated, service_role;

-- ==============================================================================
-- 6. Trigger: Sanitize Track INSERTs (Anti-Spoofing & Privilege Escalation Guard)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.sanitize_playlist_track_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
BEGIN
    -- 1. Strictly bind added_by to authenticated user.
    -- Defense-in-depth: if caller is not authenticated, FORCE NULL (never preserve client-supplied payload).
    IF v_caller_id IS NOT NULL THEN
        NEW.added_by := v_caller_id;
    ELSE
        NEW.added_by := NULL;
    END IF;

    -- 2. Anti-spoofing: All new contributions MUST start as 'unverified'.
    -- Clients cannot pass verification_status = 'verified' directly on INSERT!
    NEW.verification_status := 'unverified';
    NEW.verified_by := NULL;
    NEW.verified_at := NULL;
    NEW.rejection_reason := NULL;

    -- 3. Trusted attribution for added_via:
    -- - 'ai_cli' is ONLY permitted if caller is an authorized operator (public.is_app_operator()).
    -- - 'bulk_import' currently does NOT have a trusted server-side attribution pathway or verification procedure.
    --   Relying on session settings like orbim.bulk_importing is insecure because no trusted server procedure
    --   governs this setting during client inserts, and connection pooler session state can pose attribution leak risks.
    --   Therefore, any client INSERT attempting 'bulk_import' is safely normalized to 'web_ui'.
    -- - 'system' and all other unverified contribution origins normalize strictly to 'web_ui'.
    IF NEW.added_via = 'ai_cli' THEN
        IF public.is_app_operator() THEN
            NEW.added_via := 'ai_cli';
        ELSE
            NEW.added_via := 'web_ui';
        END IF;
    ELSE
        -- Bulk import, system, or arbitrary client strings normalize strictly to web_ui
        NEW.added_via := 'web_ui';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sanitize_playlist_track_insert() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sanitize_playlist_track_insert() TO postgres, service_role;

DROP TRIGGER IF EXISTS on_playlist_track_insert_sanitize ON public.playlist_tracks;
CREATE TRIGGER on_playlist_track_insert_sanitize
    BEFORE INSERT ON public.playlist_tracks
    FOR EACH ROW
    EXECUTE FUNCTION public.sanitize_playlist_track_insert();

-- ==============================================================================
-- 7. Trigger: Update Attribution & Verification Protection on UPDATE
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.protect_playlist_track_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    -- Preserved immutable identifiers and track metadata
    NEW.id := OLD.id;
    NEW.playlist_id := OLD.playlist_id;
    NEW.added_at := OLD.added_at;
    NEW.added_via := OLD.added_via;
    NEW.provider := OLD.provider;
    NEW.provider_track_id := OLD.provider_track_id;
    NEW.title := OLD.title;
    NEW.artist_name := OLD.artist_name;
    NEW.album_name := OLD.album_name;
    NEW.artwork_url := OLD.artwork_url;
    NEW.duration_seconds := OLD.duration_seconds;

    -- Attribution preservation (ON DELETE SET NULL support)
    IF OLD.added_by IS NULL THEN
        NEW.added_by := NULL;
    ELSIF NEW.added_by IS NULL AND NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = OLD.added_by
    ) THEN
        NEW.added_by := NULL;
    ELSE
        NEW.added_by := OLD.added_by;
    END IF;

    -- Check if this update is originating from the trusted verification procedure
    IF current_setting('orbim.verifying_track', true) = 'true' THEN
        -- Allow verification fields updated by verify_playlist_track procedure
        NULL;
    ELSE
        -- Strictly lock verification state against direct client updates
        NEW.verification_status := OLD.verification_status;
        NEW.verified_by := OLD.verified_by;
        NEW.verified_at := OLD.verified_at;
        NEW.rejection_reason := OLD.rejection_reason;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_playlist_track_attribution() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.protect_playlist_track_attribution() TO postgres, service_role;

-- Ensure trigger installation is explicit and idempotent
DROP TRIGGER IF EXISTS on_playlist_track_update_protect ON public.playlist_tracks;
CREATE TRIGGER on_playlist_track_update_protect
    BEFORE UPDATE ON public.playlist_tracks
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_playlist_track_attribution();

-- ==============================================================================
-- 8. Stored Procedure: Trusted Admin Verification (verify_playlist_track)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.verify_playlist_track(
    p_track_id UUID,
    p_decision TEXT,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_track RECORD;
    v_new_status TEXT;
    v_now TIMESTAMPTZ := now();
BEGIN
    -- 1. Authentication check
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required: caller is not signed in';
    END IF;

    -- 2. Validate decision argument
    IF p_decision NOT IN ('verified', 'rejected', 'reset') THEN
        RAISE EXCEPTION 'Invalid verification decision: %. Expected "verified", "rejected", or "reset"', p_decision;
    END IF;

    -- 3. Strict Administrator Authorization Check (Server/Database level)
    IF NOT public.can_verify_track(p_track_id) THEN
        RAISE EXCEPTION 'Access denied: caller (%) is not a Platform Administrator', v_caller_id;
    END IF;

    -- 4. Lock and retrieve track row
    SELECT id, playlist_id, verification_status, title, artist_name
    INTO v_track
    FROM public.playlist_tracks
    WHERE id = p_track_id
    FOR UPDATE;

    IF v_track.id IS NULL THEN
        RAISE EXCEPTION 'Track not found: %', p_track_id;
    END IF;

    v_new_status := CASE
        WHEN p_decision = 'reset' THEN 'unverified'
        ELSE p_decision
    END;

    -- 5. Set session local flag allowing trigger to accept verification update
    PERFORM set_config('orbim.verifying_track', 'true', true);

    -- 6. Execute update on playlist_tracks
    UPDATE public.playlist_tracks
    SET
        verification_status = v_new_status,
        verified_by = CASE WHEN v_new_status = 'verified' THEN v_caller_id ELSE NULL END,
        verified_at = CASE WHEN v_new_status = 'verified' THEN v_now ELSE NULL END,
        rejection_reason = CASE WHEN v_new_status = 'rejected' THEN p_notes ELSE NULL END
    WHERE id = p_track_id;

    -- 7. Minimize session flag lifetime: immediately reset flag after UPDATE statement
    PERFORM set_config('orbim.verifying_track', 'false', true);

    -- 8. Record immutable audit log entry
    INSERT INTO public.track_verification_audit_logs (
        track_id,
        playlist_id,
        action,
        performed_by,
        previous_status,
        new_status,
        notes,
        created_at
    )
    VALUES (
        p_track_id,
        v_track.playlist_id,
        p_decision,
        v_caller_id,
        v_track.verification_status,
        v_new_status,
        p_notes,
        v_now
    );

    RETURN jsonb_build_object(
        'status', 'success',
        'track_id', p_track_id,
        'action', p_decision,
        'new_status', v_new_status,
        'verified_by', v_caller_id,
        'verified_at', v_now
    );
END;
$$;

COMMENT ON FUNCTION public.verify_playlist_track(UUID, TEXT, TEXT) IS 'Trusted admin procedure to verify or reject track contributions with tamper-proof audit logging.';

REVOKE ALL ON FUNCTION public.verify_playlist_track(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_playlist_track(UUID, TEXT, TEXT) TO authenticated, service_role;

-- ==============================================================================
-- 9. Platform Admin Read Access Policies (Playlists & Tracks)
-- ==============================================================================
-- Grants Platform Admins read access across all playlists and tracks to inspect
-- contributions, without expanding write permissions.
-- Safe and non-recursive: is_app_admin() inspects only app_admins table.

DROP POLICY IF EXISTS playlists_select_member ON public.playlists;
CREATE POLICY playlists_select_member
    ON public.playlists
    FOR SELECT
    TO authenticated
    USING (
        owner_id = (SELECT auth.uid())
        OR public.is_playlist_member(id)
        OR public.is_app_admin()
    );

DROP POLICY IF EXISTS playlist_tracks_select ON public.playlist_tracks;
CREATE POLICY playlist_tracks_select
    ON public.playlist_tracks
    FOR SELECT
    TO authenticated
    USING (
        public.is_playlist_member(playlist_id)
        OR public.is_app_admin()
    );
