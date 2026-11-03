-- ==============================================================================
-- ORBIM — Safe Upgrade Script for Existing Remote Supabase Database
-- Target: Projects with existing tables and legacy Phase 4.1 / 4.2B schema
-- Phase: 4.2D.2 Security Remediation & Hardening
--
-- Safety Guarantees:
-- 1. Preserves all existing user data in profiles, playlists, tracks, invitations.
-- 2. Fully transactional (BEGIN ... COMMIT); rolls back on any error.
-- 3. Drops dependent RLS policies BEFORE dropping legacy 2-arg functions,
--    preventing PostgreSQL 2BP01 dependency aborts.
-- 4. Explicitly purges obsolete/zombie policies (playlist_members_insert_owner,
--    playlist_members_update_owner, playlist_invitations_update).
-- 5. Idempotent: Can be run multiple times safely.
-- 6. Aligns column defaults from timezone('utc', now()) to now().
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- Step 1: Drop All Existing RLS Policies to Sever Function Dependencies
-- ==============================================================================
-- Dynamic cleanup of ALL existing policies on application tables, regardless of
-- previous naming conventions (e.g. playlist_members_select_related,
-- playlist_tracks_update_owner_or_adder). This completely severs dependencies
-- before dropping legacy functions, preventing PostgreSQL 2BP01 errors.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT policyname, tablename
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('profiles', 'playlists', 'playlist_members', 'playlist_tracks', 'playlist_invitations')
    ) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    END LOOP;
END $$;

-- Explicit drops of known policy names as fallback
DROP POLICY IF EXISTS profiles_select_authenticated ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;

DROP POLICY IF EXISTS playlists_select_member ON public.playlists;
DROP POLICY IF EXISTS playlists_insert_owner ON public.playlists;
DROP POLICY IF EXISTS playlists_update_owner ON public.playlists;
DROP POLICY IF EXISTS playlists_delete_owner ON public.playlists;

DROP POLICY IF EXISTS playlist_members_select ON public.playlist_members;
DROP POLICY IF EXISTS playlist_members_select_related ON public.playlist_members;
DROP POLICY IF EXISTS playlist_members_insert_owner ON public.playlist_members;
DROP POLICY IF EXISTS playlist_members_update_owner ON public.playlist_members;
DROP POLICY IF EXISTS playlist_members_delete ON public.playlist_members;

DROP POLICY IF EXISTS playlist_tracks_select ON public.playlist_tracks;
DROP POLICY IF EXISTS playlist_tracks_select_member ON public.playlist_tracks;
DROP POLICY IF EXISTS playlist_tracks_insert ON public.playlist_tracks;
DROP POLICY IF EXISTS playlist_tracks_insert_member ON public.playlist_tracks;
DROP POLICY IF EXISTS playlist_tracks_update ON public.playlist_tracks;
DROP POLICY IF EXISTS playlist_tracks_update_owner_or_adder ON public.playlist_tracks;
DROP POLICY IF EXISTS playlist_tracks_delete ON public.playlist_tracks;

DROP POLICY IF EXISTS playlist_invitations_select ON public.playlist_invitations;
DROP POLICY IF EXISTS playlist_invitations_insert ON public.playlist_invitations;
DROP POLICY IF EXISTS playlist_invitations_update ON public.playlist_invitations;
DROP POLICY IF EXISTS playlist_invitations_delete ON public.playlist_invitations;

-- ==============================================================================
-- Step 2: Remove Legacy Functions with Outdated Signatures
-- ==============================================================================
-- Safe to drop with CASCADE now that all dependent policies are eliminated.
DROP FUNCTION IF EXISTS public.is_playlist_member(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.is_playlist_owner(UUID, UUID) CASCADE;

-- ==============================================================================
-- Step 3: Upgrade Column Defaults to now() (TIMESTAMPTZ Standardization)
-- ==============================================================================
-- Existing tables created under earlier schema versions may retain the
-- timezone('utc', now()) default. This updates defaults for all future inserts.
ALTER TABLE public.profiles ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.profiles ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE public.playlists ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.playlists ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE public.playlist_members ALTER COLUMN joined_at SET DEFAULT now();

ALTER TABLE public.playlist_tracks ALTER COLUMN added_at SET DEFAULT now();

ALTER TABLE public.playlist_invitations ALTER COLUMN created_at SET DEFAULT now();

-- ==============================================================================
-- Step 4: Ensure All Required Indexes Exist
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_playlists_owner ON public.playlists(owner_id);
CREATE INDEX IF NOT EXISTS idx_playlist_members_user ON public.playlist_members(user_id);
CREATE INDEX IF NOT EXISTS idx_playlist_members_playlist ON public.playlist_members(playlist_id);

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist_position
    ON public.playlist_tracks(playlist_id, position ASC);

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_added_by
    ON public.playlist_tracks(added_by)
    WHERE added_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_playlist_invitations_token_hash
    ON public.playlist_invitations(token_hash)
    WHERE accepted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_playlist_invitations_playlist
    ON public.playlist_invitations(playlist_id);

CREATE INDEX IF NOT EXISTS idx_playlist_invitations_created_by
    ON public.playlist_invitations(created_by);

-- ==============================================================================
-- Step 5: Create / Replace All Functions & Procedures (Hardened)
-- ==============================================================================

-- 5.1 Profile creation trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_raw_display_name TEXT;
    v_clean_display_name TEXT;
    v_avatar_url TEXT;
BEGIN
    v_raw_display_name := trim(coalesce(
        NEW.raw_user_meta_data->>'display_name',
        NEW.raw_user_meta_data->>'full_name',
        split_part(coalesce(NEW.email, ''), '@', 1),
        'Music Explorer'
    ));

    IF char_length(v_raw_display_name) < 2 THEN
        v_clean_display_name := 'Music Explorer';
    ELSIF char_length(v_raw_display_name) > 50 THEN
        v_clean_display_name := substr(v_raw_display_name, 1, 50);
    ELSE
        v_clean_display_name := v_raw_display_name;
    END IF;

    v_avatar_url := NULLIF(trim(coalesce(NEW.raw_user_meta_data->>'avatar_url', '')), '');
    IF v_avatar_url IS NOT NULL AND v_avatar_url !~* '^https?://' THEN
        v_avatar_url := NULL;
    END IF;

    INSERT INTO public.profiles (id, display_name, avatar_url, created_at, updated_at)
    VALUES (
        NEW.id,
        v_clean_display_name,
        v_avatar_url,
        now(),
        now()
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, supabase_auth_admin, service_role;

-- 5.2 Helper function: is_playlist_member (Single Parameter, auth.uid() Scoped)
CREATE OR REPLACE FUNCTION public.is_playlist_member(p_playlist_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.playlist_members
        WHERE playlist_id = p_playlist_id
          AND user_id = auth.uid()
    );
$$;

COMMENT ON FUNCTION public.is_playlist_member(UUID) IS 'Non-recursive security check determining if the calling user is an active member of a playlist.';

REVOKE ALL ON FUNCTION public.is_playlist_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_playlist_member(UUID) TO authenticated, service_role;

-- 5.3 Helper function: is_playlist_owner (Single Parameter, auth.uid() Scoped)
CREATE OR REPLACE FUNCTION public.is_playlist_owner(p_playlist_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.playlists
        WHERE id = p_playlist_id
          AND owner_id = auth.uid()
    );
$$;

COMMENT ON FUNCTION public.is_playlist_owner(UUID) IS 'Non-recursive security check determining if the calling user is the owner of a playlist.';

REVOKE ALL ON FUNCTION public.is_playlist_owner(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_playlist_owner(UUID) TO authenticated, service_role;

-- 5.4 Automatic owner membership trigger
CREATE OR REPLACE FUNCTION public.handle_new_playlist_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    INSERT INTO public.playlist_members (playlist_id, user_id, role, joined_at)
    VALUES (NEW.id, NEW.owner_id, 'owner', now())
    ON CONFLICT (playlist_id, user_id) DO NOTHING;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_playlist_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_playlist_owner() TO postgres, service_role;

-- 5.5 Automatic playlist updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_playlist_self_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_playlist_self_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.touch_playlist_self_updated_at() TO postgres, service_role;

-- 5.6 Track attribution & metadata protection trigger (Immutable Jamendo metadata)
CREATE OR REPLACE FUNCTION public.protect_playlist_track_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    NEW.id := OLD.id;
    NEW.playlist_id := OLD.playlist_id;
    NEW.added_at := OLD.added_at;
    NEW.provider := OLD.provider;
    NEW.provider_track_id := OLD.provider_track_id;
    NEW.title := OLD.title;
    NEW.artist_name := OLD.artist_name;
    NEW.album_name := OLD.album_name;
    NEW.artwork_url := OLD.artwork_url;
    NEW.duration_seconds := OLD.duration_seconds;

    IF OLD.added_by IS NULL THEN
        NEW.added_by := NULL;
    ELSIF NEW.added_by IS NULL AND NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = OLD.added_by
    ) THEN
        NEW.added_by := NULL;
    ELSE
        NEW.added_by := OLD.added_by;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_playlist_track_attribution() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.protect_playlist_track_attribution() TO postgres, service_role;

-- 5.7 Touch playlist updated_at on track mutation (INSERT or DELETE only)
CREATE OR REPLACE FUNCTION public.touch_playlist_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_playlist_id UUID := coalesce(NEW.playlist_id, OLD.playlist_id);
BEGIN
    UPDATE public.playlists
    SET updated_at = now()
    WHERE id = v_playlist_id;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_playlist_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.touch_playlist_updated_at() TO postgres, service_role;

-- 5.8 Stored Procedure: Rebalance Track Positions
CREATE OR REPLACE FUNCTION public.rebalance_playlist_track_positions(p_playlist_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
BEGIN
    IF v_caller_id IS NULL OR NOT public.is_playlist_member(p_playlist_id) THEN
        RAISE EXCEPTION 'Access denied: caller is not a member of playlist %', p_playlist_id;
    END IF;

    PERFORM 1 FROM public.playlists WHERE id = p_playlist_id FOR UPDATE;

    WITH locked AS (
        SELECT id, position, added_at
        FROM public.playlist_tracks
        WHERE playlist_id = p_playlist_id
        FOR UPDATE
    ),
    ranked AS (
        SELECT
            id,
            (row_number() OVER (ORDER BY position ASC, added_at ASC)) * 1000.0 AS new_position
        FROM locked
    )
    UPDATE public.playlist_tracks t
    SET position = r.new_position
    FROM ranked r
    WHERE t.id = r.id;

    UPDATE public.playlists
    SET updated_at = now()
    WHERE id = p_playlist_id;
END;
$$;

COMMENT ON FUNCTION public.rebalance_playlist_track_positions(UUID) IS 'Rebalances fractional track positions in a playlist back to clean 1000-spaced intervals.';

REVOKE ALL ON FUNCTION public.rebalance_playlist_track_positions(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rebalance_playlist_track_positions(UUID) TO authenticated, service_role;

-- 5.9 Invitation expiry limit trigger
CREATE OR REPLACE FUNCTION public.enforce_invitation_expiry_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.expires_at <= NEW.created_at THEN
        RAISE EXCEPTION 'Invitation expiry must be after creation time.'
            USING ERRCODE = 'ORB07';
    END IF;

    IF NEW.expires_at > NEW.created_at + interval '7 days' THEN
        RAISE EXCEPTION 'Invitation expiry cannot exceed 7 days from creation.'
            USING ERRCODE = 'ORB08';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_invitation_expiry_limit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_invitation_expiry_limit() TO postgres, service_role;

-- 5.10 Stored Procedure: Atomic Invitation Acceptance
CREATE OR REPLACE FUNCTION public.accept_playlist_invitation(p_token TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_token_hash TEXT;
    v_invitation RECORD;
    v_playlist RECORD;
    v_existing_role TEXT;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required: must be signed in to accept a playlist invitation.'
            USING ERRCODE = 'ORB01';
    END IF;

    IF p_token IS NULL OR char_length(trim(p_token)) < 16 THEN
        RAISE EXCEPTION 'Invalid invitation format: token is missing or malformed.'
            USING ERRCODE = 'ORB02';
    END IF;

    v_token_hash := encode(sha256(convert_to(lower(trim(p_token)), 'UTF8')), 'hex');

    SELECT id, playlist_id, role, expires_at, accepted_at
    INTO v_invitation
    FROM public.playlist_invitations
    WHERE token_hash = v_token_hash
    FOR UPDATE;

    IF v_invitation.id IS NULL THEN
        RAISE EXCEPTION 'Invitation not found or token is invalid.'
            USING ERRCODE = 'ORB03';
    END IF;

    IF v_invitation.accepted_at IS NOT NULL THEN
        RAISE EXCEPTION 'This invitation has already been accepted and is no longer valid.'
            USING ERRCODE = 'ORB04';
    END IF;

    IF v_invitation.expires_at <= now() THEN
        RAISE EXCEPTION 'This invitation has expired.'
            USING ERRCODE = 'ORB05';
    END IF;

    SELECT id, title, visibility, owner_id
    INTO v_playlist
    FROM public.playlists
    WHERE id = v_invitation.playlist_id;

    IF v_playlist.id IS NULL THEN
        RAISE EXCEPTION 'The target playlist for this invitation no longer exists.'
            USING ERRCODE = 'ORB06';
    END IF;

    IF v_caller_id = v_playlist.owner_id THEN
        RETURN jsonb_build_object(
            'status', 'already_member',
            'playlist_id', v_invitation.playlist_id,
            'playlist_title', v_playlist.title,
            'role', 'owner'
        );
    END IF;

    SELECT role INTO v_existing_role
    FROM public.playlist_members
    WHERE playlist_id = v_invitation.playlist_id
      AND user_id = v_caller_id;

    IF v_existing_role IS NOT NULL THEN
        UPDATE public.playlist_invitations
        SET accepted_at = now()
        WHERE id = v_invitation.id;

        RETURN jsonb_build_object(
            'status', 'already_member',
            'playlist_id', v_invitation.playlist_id,
            'playlist_title', v_playlist.title,
            'role', v_existing_role
        );
    END IF;

    UPDATE public.playlist_invitations
    SET accepted_at = now()
    WHERE id = v_invitation.id;

    INSERT INTO public.playlist_members (playlist_id, user_id, role, joined_at)
    VALUES (v_invitation.playlist_id, v_caller_id, v_invitation.role, now());

    UPDATE public.playlists
    SET visibility = 'shared',
        updated_at = now()
    WHERE id = v_invitation.playlist_id;

    RETURN jsonb_build_object(
        'status', 'success',
        'playlist_id', v_invitation.playlist_id,
        'playlist_title', v_playlist.title,
        'role', v_invitation.role
    );
END;
$$;

COMMENT ON FUNCTION public.accept_playlist_invitation(TEXT) IS 'Atomically accepts a playlist invitation, hashes the token server-side, row-locks the record, and adds the authenticated caller as editor.';

REVOKE ALL ON FUNCTION public.accept_playlist_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_playlist_invitation(TEXT) TO authenticated;

-- ==============================================================================
-- Step 6: Recreate Triggers (Idempotent)
-- ==============================================================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS on_playlist_created_add_owner ON public.playlists;
CREATE TRIGGER on_playlist_created_add_owner
    AFTER INSERT ON public.playlists
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_playlist_owner();

DROP TRIGGER IF EXISTS on_playlist_before_update ON public.playlists;
CREATE TRIGGER on_playlist_before_update
    BEFORE UPDATE ON public.playlists
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_playlist_self_updated_at();

DROP TRIGGER IF EXISTS on_playlist_track_update_protect ON public.playlist_tracks;
CREATE TRIGGER on_playlist_track_update_protect
    BEFORE UPDATE ON public.playlist_tracks
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_playlist_track_attribution();

DROP TRIGGER IF EXISTS on_playlist_track_touch_playlist ON public.playlist_tracks;
CREATE TRIGGER on_playlist_track_touch_playlist
    AFTER INSERT OR DELETE ON public.playlist_tracks
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_playlist_updated_at();

DROP TRIGGER IF EXISTS on_playlist_invitation_before_insert ON public.playlist_invitations;
CREATE TRIGGER on_playlist_invitation_before_insert
    BEFORE INSERT ON public.playlist_invitations
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_invitation_expiry_limit();

-- ==============================================================================
-- Step 7: Enforce and Enable RLS on All Application Tables
-- ==============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlists FORCE ROW LEVEL SECURITY;

ALTER TABLE public.playlist_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_members FORCE ROW LEVEL SECURITY;

ALTER TABLE public.playlist_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_tracks FORCE ROW LEVEL SECURITY;

ALTER TABLE public.playlist_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_invitations FORCE ROW LEVEL SECURITY;

-- ==============================================================================
-- Step 8: Create Hardened RLS Policies (Phase 4.2D.2)
-- ==============================================================================

-- 8.1 Profiles
CREATE POLICY profiles_select_authenticated
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY profiles_update_own
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (id = (SELECT auth.uid()))
    WITH CHECK (id = (SELECT auth.uid()));

-- 8.2 Playlists
CREATE POLICY playlists_select_member
    ON public.playlists
    FOR SELECT
    TO authenticated
    USING (
        owner_id = (SELECT auth.uid())
        OR public.is_playlist_member(id)
    );

CREATE POLICY playlists_insert_owner
    ON public.playlists
    FOR INSERT
    TO authenticated
    WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY playlists_update_owner
    ON public.playlists
    FOR UPDATE
    TO authenticated
    USING (owner_id = (SELECT auth.uid()))
    WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY playlists_delete_owner
    ON public.playlists
    FOR DELETE
    TO authenticated
    USING (owner_id = (SELECT auth.uid()));

-- 8.3 Playlist Members (Strict Invite-Only, No Direct UPDATE)
CREATE POLICY playlist_members_select
    ON public.playlist_members
    FOR SELECT
    TO authenticated
    USING (
        public.is_playlist_owner(playlist_id)
        OR public.is_playlist_member(playlist_id)
    );

CREATE POLICY playlist_members_delete
    ON public.playlist_members
    FOR DELETE
    TO authenticated
    USING (
        (public.is_playlist_owner(playlist_id) AND user_id != (SELECT auth.uid()))
        OR (user_id = (SELECT auth.uid()) AND NOT public.is_playlist_owner(playlist_id))
    );

-- 8.4 Playlist Tracks
CREATE POLICY playlist_tracks_select
    ON public.playlist_tracks
    FOR SELECT
    TO authenticated
    USING (public.is_playlist_member(playlist_id));

CREATE POLICY playlist_tracks_insert
    ON public.playlist_tracks
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_playlist_member(playlist_id)
        AND added_by = (SELECT auth.uid())
    );

CREATE POLICY playlist_tracks_update
    ON public.playlist_tracks
    FOR UPDATE
    TO authenticated
    USING (public.is_playlist_member(playlist_id))
    WITH CHECK (public.is_playlist_member(playlist_id));

CREATE POLICY playlist_tracks_delete
    ON public.playlist_tracks
    FOR DELETE
    TO authenticated
    USING (
        public.is_playlist_owner(playlist_id)
        OR added_by = (SELECT auth.uid())
    );

-- 8.5 Playlist Invitations
CREATE POLICY playlist_invitations_select
    ON public.playlist_invitations
    FOR SELECT
    TO authenticated
    USING (public.is_playlist_owner(playlist_id));

CREATE POLICY playlist_invitations_insert
    ON public.playlist_invitations
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_playlist_owner(playlist_id)
        AND created_by = (SELECT auth.uid())
        AND expires_at > now()
        AND expires_at <= now() + interval '7 days'
    );

CREATE POLICY playlist_invitations_delete
    ON public.playlist_invitations
    FOR DELETE
    TO authenticated
    USING (public.is_playlist_owner(playlist_id));

-- ==============================================================================
-- Step 9: Table Grants and Privileges Lockdown
-- ==============================================================================
REVOKE ALL ON TABLE public.profiles, public.playlists, public.playlist_members, public.playlist_tracks, public.playlist_invitations FROM anon, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.playlists TO authenticated;
GRANT SELECT, DELETE ON TABLE public.playlist_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.playlist_tracks TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.playlist_invitations TO authenticated;

COMMIT;
