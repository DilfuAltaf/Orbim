-- ORBIM — Complete Database Foundation Schema (Hardened)
-- Compiles migrations 1 through 7 in dependency order.

/* ==========================================================================
   File: 20261023000001_create_profiles.sql
   ========================================================================== */

-- Migration 1: Profiles and Automatic User Provisioning
-- ORBIM Phase 4.1 Database Foundation (Hardened)

-- 1. Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    location TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT display_name_length CHECK (char_length(trim(display_name)) BETWEEN 2 AND 50),
    CONSTRAINT avatar_url_format CHECK (avatar_url IS NULL OR avatar_url ~* '^https?://'),
    CONSTRAINT location_length CHECK (location IS NULL OR char_length(location) <= 100)
);

COMMENT ON TABLE public.profiles IS 'Public user profile metadata linked to Supabase Auth identities.';
COMMENT ON COLUMN public.profiles.id IS 'References auth.users(id); matches auth.uid().';
COMMENT ON COLUMN public.profiles.display_name IS 'Collaborator display name visible to peers on shared playlists.';

-- 2. Trigger function to automatically create profile on auth.users insert
-- HARDENING: Fixed search_path = pg_catalog; all public objects explicitly qualified
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
    -- Extract display name from user metadata, falling back safely
    v_raw_display_name := trim(coalesce(
        NEW.raw_user_meta_data->>'display_name',
        NEW.raw_user_meta_data->>'full_name',
        split_part(coalesce(NEW.email, ''), '@', 1),
        'Music Explorer'
    ));

    -- Enforce 2..50 character constraint bounds on extracted name
    IF char_length(v_raw_display_name) < 2 THEN
        v_clean_display_name := 'Music Explorer';
    ELSIF char_length(v_raw_display_name) > 50 THEN
        v_clean_display_name := substr(v_raw_display_name, 1, 50);
    ELSE
        v_clean_display_name := v_raw_display_name;
    END IF;

    -- Extract avatar URL if provided and valid
    v_avatar_url := NULLIF(trim(coalesce(NEW.raw_user_meta_data->>'avatar_url', '')), '');
    IF v_avatar_url IS NOT NULL AND v_avatar_url !~* '^https?://' THEN
        v_avatar_url := NULL;
    END IF;

    -- Idempotent profile insertion using NEW.id directly from trusted auth.users
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

COMMENT ON FUNCTION public.handle_new_user() IS 'Trigger function that provisions a public.profiles row when auth.users is created.';

-- 3. Privilege restriction on trigger function: Only internal auth and db owners can execute
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, supabase_auth_admin, service_role;

-- 4. Attach trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

/* ==========================================================================
   File: 20261023000002_create_playlists_and_members.sql
   ========================================================================== */

-- Migration 2: Playlists, Membership, and Access Checks
-- ORBIM Phase 4.1 Database Foundation (Hardened)

-- 1. Create playlists table
CREATE TABLE IF NOT EXISTS public.playlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    visibility TEXT NOT NULL DEFAULT 'private',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT playlist_title_length CHECK (char_length(trim(title)) BETWEEN 1 AND 100),
    CONSTRAINT playlist_description_length CHECK (description IS NULL OR char_length(description) <= 500),
    CONSTRAINT playlist_visibility_valid CHECK (visibility IN ('private', 'shared'))
);

COMMENT ON TABLE public.playlists IS 'Playlists created by users; either private or shared with invited collaborators.';
COMMENT ON COLUMN public.playlists.owner_id IS 'References the profile of the creator who retains full owner permissions.';
COMMENT ON COLUMN public.playlists.visibility IS 'Access level: private (owner only) or shared (owner + invited editors).';

-- 2. Create playlist_members table
CREATE TABLE IF NOT EXISTS public.playlist_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id UUID NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'editor',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT playlist_member_role_valid CHECK (role IN ('owner', 'editor')),
    CONSTRAINT playlist_member_unique UNIQUE (playlist_id, user_id)
);

COMMENT ON TABLE public.playlist_members IS 'User membership and collaborator roles within playlists.';
COMMENT ON COLUMN public.playlist_members.role IS 'Collaborator role: owner (full management) or editor (modify tracks).';

-- 3. Indexes for membership and playlist queries
CREATE INDEX IF NOT EXISTS idx_playlists_owner ON public.playlists(owner_id);
CREATE INDEX IF NOT EXISTS idx_playlist_members_user ON public.playlist_members(user_id);
CREATE INDEX IF NOT EXISTS idx_playlist_members_playlist ON public.playlist_members(playlist_id);

-- 4. Helper function: is_playlist_member
-- HARDENING: Fixed search_path = pg_catalog; derives current caller from auth.uid()
-- Explicitly drop old 2-argument signature to prevent PostgREST RPC membership probing
DROP FUNCTION IF EXISTS public.is_playlist_member(UUID, UUID);

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

-- 5. Helper function: is_playlist_owner
-- HARDENING: Fixed search_path = pg_catalog; derives current caller from auth.uid()
-- Explicitly drop old 2-argument signature to prevent PostgREST RPC ownership probing
DROP FUNCTION IF EXISTS public.is_playlist_owner(UUID, UUID);

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

-- 6. Trigger: Automatically add owner to playlist_members on playlist creation
-- HARDENING: Fixed search_path = pg_catalog; executed only internally by the database
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
-- Grant strictly to database owner / service role; authenticated users do not need direct execution privileges
GRANT EXECUTE ON FUNCTION public.handle_new_playlist_owner() TO postgres, service_role;

DROP TRIGGER IF EXISTS on_playlist_created_add_owner ON public.playlists;
CREATE TRIGGER on_playlist_created_add_owner
    AFTER INSERT ON public.playlists
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_playlist_owner();

-- 7. Trigger: Automatically update playlists.updated_at on direct update
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

DROP TRIGGER IF EXISTS on_playlist_before_update ON public.playlists;
CREATE TRIGGER on_playlist_before_update
    BEFORE UPDATE ON public.playlists
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_playlist_self_updated_at();

/* ==========================================================================
   File: 20261023000003_create_playlist_tracks.sql
   ========================================================================== */

-- Migration 3: Playlist Tracks, Fractional Ordering, and Attribution Protection
-- ORBIM Phase 4.1 Database Foundation (Hardened)

-- 1. Create playlist_tracks table
-- DELETION POLICY RESOLUTION: `added_by` is intentionally NULLABLE to support `ON DELETE SET NULL`.
-- If a collaborator deletes their account, their tracks remain preserved in collaborative playlists
-- with `added_by = NULL` rather than cascading and destructively erasing songs from shared playlists.
CREATE TABLE IF NOT EXISTS public.playlist_tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id UUID NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'jamendo',
    provider_track_id TEXT NOT NULL,
    title TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    album_name TEXT,
    artwork_url TEXT,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    position NUMERIC NOT NULL,
    added_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT track_title_not_empty CHECK (char_length(trim(title)) > 0),
    CONSTRAINT track_artist_not_empty CHECK (char_length(trim(artist_name)) > 0),
    CONSTRAINT track_duration_non_negative CHECK (duration_seconds >= 0),
    CONSTRAINT track_position_finite CHECK (position > 0),
    CONSTRAINT playlist_track_unique UNIQUE (playlist_id, provider, provider_track_id)
);

COMMENT ON TABLE public.playlist_tracks IS 'Tracks saved inside a playlist, ordered by a fractional numeric position.';
COMMENT ON COLUMN public.playlist_tracks.position IS 'Fractional numeric rank (e.g. 1000.0, 2000.0, 1500.0) allowing midpoint insertions without full re-indexing.';
COMMENT ON COLUMN public.playlist_tracks.added_by IS 'Profile ID of the collaborator who added the track. Sets to NULL on account deletion without removing the track.';

-- 2. Indexes for ordering and lookup
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist_position
    ON public.playlist_tracks(playlist_id, position ASC);

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_added_by
    ON public.playlist_tracks(added_by)
    WHERE added_by IS NOT NULL;

-- 3. Trigger: Attribution, Metadata & Identity Protection on Track Updates
-- Prevents any collaborator from modifying added_by, added_at, title, artist, album, artwork, duration, or moving tracks.
-- Only fractional position may be mutated for reordering.
-- HARDENING: Allows added_by to become NULL ONLY during foreign-key profile deletion (ON DELETE SET NULL),
-- while strictly blocking client-initiated attempts to clear or tamper with attribution and track metadata.
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

    -- Allow added_by to become NULL only if the referenced profile is being deleted (ON DELETE SET NULL)
    IF OLD.added_by IS NULL THEN
        NEW.added_by := NULL;
    ELSIF NEW.added_by IS NULL AND NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = OLD.added_by
    ) THEN
        NEW.added_by := NULL;
    ELSE
        -- Strictly preserve original attribution on client updates
        NEW.added_by := OLD.added_by;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_playlist_track_attribution() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.protect_playlist_track_attribution() TO postgres, service_role;

DROP TRIGGER IF EXISTS on_playlist_track_update_protect ON public.playlist_tracks;
CREATE TRIGGER on_playlist_track_update_protect
    BEFORE UPDATE ON public.playlist_tracks
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_playlist_track_attribution();

-- 4. Trigger: Touch parent playlist updated_at on track mutation
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

DROP TRIGGER IF EXISTS on_playlist_track_touch_playlist ON public.playlist_tracks;
CREATE TRIGGER on_playlist_track_touch_playlist
    AFTER INSERT OR DELETE ON public.playlist_tracks
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_playlist_updated_at();

-- 5. Stored Procedure: Rebalance Track Positions
-- HARDENING: Fixed search_path = pg_catalog; acquires parent playlist row lock to serialize concurrent rebalances.
CREATE OR REPLACE FUNCTION public.rebalance_playlist_track_positions(p_playlist_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
BEGIN
    -- 1. Verify caller has member permissions on this playlist
    IF v_caller_id IS NULL OR NOT public.is_playlist_member(p_playlist_id) THEN
        RAISE EXCEPTION 'Access denied: caller is not a member of playlist %', p_playlist_id;
    END IF;

    -- 2. Lock parent playlist row to cleanly serialize all concurrent rebalances for this playlist
    PERFORM 1 FROM public.playlists WHERE id = p_playlist_id FOR UPDATE;

    -- 3. Atomically rewrite positions with spaced values (1000, 2000, 3000...)
    -- Explicit row locking is performed in 'locked' CTE to preserve concurrency safety
    -- while keeping the window function in 'ranked' syntactically compliant with PostgreSQL.
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

    -- 4. Update playlist updated_at timestamp
    UPDATE public.playlists
    SET updated_at = now()
    WHERE id = p_playlist_id;
END;
$$;

COMMENT ON FUNCTION public.rebalance_playlist_track_positions(UUID) IS 'Rebalances fractional track positions in a playlist back to clean 1000-spaced intervals.';

REVOKE ALL ON FUNCTION public.rebalance_playlist_track_positions(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rebalance_playlist_track_positions(UUID) TO authenticated, service_role;

/* ==========================================================================
   File: 20261023000004_create_playlist_invitations.sql
   ========================================================================== */

-- Migration 4: Playlist Invitations and Atomic Acceptance
-- ORBIM Phase 4.1 Database Foundation (Hardened)

-- 1. Create playlist_invitations table
CREATE TABLE IF NOT EXISTS public.playlist_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id UUID NOT NULL REFERENCES public.playlists(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'editor',
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT invitation_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT invitation_role_valid CHECK (role IN ('editor')),
    CONSTRAINT invitation_expiry_valid CHECK (expires_at > created_at),
    CONSTRAINT invitation_token_hash_unique UNIQUE (token_hash)
);

COMMENT ON TABLE public.playlist_invitations IS 'Hashed, single-use, expiring invitation tokens for collaborative playlists.';
COMMENT ON COLUMN public.playlist_invitations.token_hash IS 'SHA-256 lowercase hex digest of the raw invitation secret. The raw secret is never stored.';
COMMENT ON COLUMN public.playlist_invitations.role IS 'Permitted collaborator role granted on acceptance (strictly "editor").';

-- 2. Indexes for token lookup, expiration, and foreign-key cascades
CREATE INDEX IF NOT EXISTS idx_playlist_invitations_token_hash
    ON public.playlist_invitations(token_hash)
    WHERE accepted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_playlist_invitations_playlist
    ON public.playlist_invitations(playlist_id);

CREATE INDEX IF NOT EXISTS idx_playlist_invitations_created_by
    ON public.playlist_invitations(created_by);

-- 3. Trigger: Enforce maximum 7-day invitation lifetime
CREATE OR REPLACE FUNCTION public.enforce_invitation_expiry_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    -- Expiry must be after creation time
    IF NEW.expires_at <= NEW.created_at THEN
        RAISE EXCEPTION 'Invitation expiry must be after creation time.'
            USING ERRCODE = 'ORB07';
    END IF;

    -- Maximum 7 days validity from creation
    IF NEW.expires_at > NEW.created_at + interval '7 days' THEN
        RAISE EXCEPTION 'Invitation expiry cannot exceed 7 days from creation.'
            USING ERRCODE = 'ORB08';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_invitation_expiry_limit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_invitation_expiry_limit() TO postgres, service_role;

DROP TRIGGER IF EXISTS on_playlist_invitation_before_insert ON public.playlist_invitations;
CREATE TRIGGER on_playlist_invitation_before_insert
    BEFORE INSERT ON public.playlist_invitations
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_invitation_expiry_limit();

-- 4. Stored Procedure: Atomic Invitation Acceptance
-- HARDENING: Fixed search_path = pg_catalog; case-insensitive token hash; row-locked acceptance transaction
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
    -- 1. Validate caller authentication
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required: must be signed in to accept a playlist invitation.'
            USING ERRCODE = 'ORB01';
    END IF;

    -- 2. Validate token parameter format
    IF p_token IS NULL OR char_length(trim(p_token)) < 16 THEN
        RAISE EXCEPTION 'Invalid invitation format: token is missing or malformed.'
            USING ERRCODE = 'ORB02';
    END IF;

    -- 3. Compute SHA-256 lowercase hex hash of the normalized (lowercase trimmed) token
    v_token_hash := encode(sha256(convert_to(lower(trim(p_token)), 'UTF8')), 'hex');

    -- 4. Query and lock the invitation row to prevent concurrent race conditions
    SELECT id, playlist_id, role, expires_at, accepted_at
    INTO v_invitation
    FROM public.playlist_invitations
    WHERE token_hash = v_token_hash
    FOR UPDATE;

    IF v_invitation.id IS NULL THEN
        RAISE EXCEPTION 'Invitation not found or token is invalid.'
            USING ERRCODE = 'ORB03';
    END IF;

    -- 5. Replay protection: Verify invitation has not already been accepted
    IF v_invitation.accepted_at IS NOT NULL THEN
        RAISE EXCEPTION 'This invitation has already been accepted and is no longer valid.'
            USING ERRCODE = 'ORB04';
    END IF;

    -- 6. Expiration check
    IF v_invitation.expires_at <= now() THEN
        RAISE EXCEPTION 'This invitation has expired.'
            USING ERRCODE = 'ORB05';
    END IF;

    -- 7. Verify target playlist exists
    SELECT id, title, visibility, owner_id
    INTO v_playlist
    FROM public.playlists
    WHERE id = v_invitation.playlist_id;

    IF v_playlist.id IS NULL THEN
        RAISE EXCEPTION 'The target playlist for this invitation no longer exists.'
            USING ERRCODE = 'ORB06';
    END IF;

    -- 8. Existing member handling:
    -- If caller is the playlist owner, do not consume the token so the owner can preview their link safely.
    IF v_caller_id = v_playlist.owner_id THEN
        RETURN jsonb_build_object(
            'status', 'already_member',
            'playlist_id', v_invitation.playlist_id,
            'playlist_title', v_playlist.title,
            'role', 'owner'
        );
    END IF;

    -- If caller is already an editor, consume the token and confirm membership to prevent token recycling.
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

    -- 9. Atomic mutation: Consume invitation and grant editor membership
    UPDATE public.playlist_invitations
    SET accepted_at = now()
    WHERE id = v_invitation.id;

    INSERT INTO public.playlist_members (playlist_id, user_id, role, joined_at)
    VALUES (v_invitation.playlist_id, v_caller_id, v_invitation.role, now());

    -- Promote playlist to 'shared' and touch updated_at
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

/* ==========================================================================
   File: 20261023000005_security_and_rls.sql
   ========================================================================== */

-- Migration 5: Row Level Security (RLS) Policies and Access Control
-- ORBIM Phase 4.1 Database Foundation (Hardened)

-- ==============================================================================
-- 1. Enable and Force Row Level Security on all application tables
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
-- 2. Profiles Policies
-- ==============================================================================
-- Anyone authenticated can view collaborator profile information
CREATE POLICY profiles_select_authenticated
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (true);

-- Users can only modify their own display name, avatar, and location
CREATE POLICY profiles_update_own
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (id = (SELECT auth.uid()))
    WITH CHECK (id = (SELECT auth.uid()));

-- Direct INSERTs by regular users are disallowed; handled solely by the handle_new_user trigger.
-- Direct DELETEs by regular users are disallowed; handled through auth cascade.

-- ==============================================================================
-- 3. Playlists Policies
-- ==============================================================================
-- Playlists can be viewed by the owner or any active collaborator member
CREATE POLICY playlists_select_member
    ON public.playlists
    FOR SELECT
    TO authenticated
    USING (
        owner_id = (SELECT auth.uid())
        OR public.is_playlist_member(id)
    );

-- Authenticated users can create playlists only with themselves set as owner
CREATE POLICY playlists_insert_owner
    ON public.playlists
    FOR INSERT
    TO authenticated
    WITH CHECK (owner_id = (SELECT auth.uid()));

-- Only the owner can rename, update description, or modify playlist settings
-- Enforces owner_id = (SELECT auth.uid()) in WITH CHECK to prevent ownership hijacking
CREATE POLICY playlists_update_owner
    ON public.playlists
    FOR UPDATE
    TO authenticated
    USING (owner_id = (SELECT auth.uid()))
    WITH CHECK (owner_id = (SELECT auth.uid()));

-- Only the owner can delete their playlist
CREATE POLICY playlists_delete_owner
    ON public.playlists
    FOR DELETE
    TO authenticated
    USING (owner_id = (SELECT auth.uid()));

-- ==============================================================================
-- 4. Playlist Members Policies
-- ==============================================================================
-- Members can view the list of collaborators on playlists they belong to
CREATE POLICY playlist_members_select
    ON public.playlist_members
    FOR SELECT
    TO authenticated
    USING (
        public.is_playlist_owner(playlist_id)
        OR public.is_playlist_member(playlist_id)
    );

-- Direct member insertion is disallowed (D1 Option A: invite-only model).
-- The playlist owner is added automatically upon creation via handle_new_playlist_owner trigger.
-- Collaborators join exclusively by calling accept_playlist_invitation(token).

-- Direct member update is disallowed (D3 Option A).
-- Role mutations, user reassignment, and owner hijacking are strictly prevented.
-- Collaborator departures and removals are handled via DELETE.

-- Owner can remove members; members can voluntarily leave (remove themselves).
-- HARDENING: Prevents owners from accidentally deleting their own owner membership and orphaning the playlist.
CREATE POLICY playlist_members_delete
    ON public.playlist_members
    FOR DELETE
    TO authenticated
    USING (
        -- Owner can remove any editor, but cannot delete their own owner membership
        (public.is_playlist_owner(playlist_id) AND user_id != (SELECT auth.uid()))
        -- An editor can remove themselves (leave the playlist)
        OR (user_id = (SELECT auth.uid()) AND NOT public.is_playlist_owner(playlist_id))
    );

-- ==============================================================================
-- 5. Playlist Tracks Policies
-- ==============================================================================
-- Any member can view the tracks in a playlist
CREATE POLICY playlist_tracks_select
    ON public.playlist_tracks
    FOR SELECT
    TO authenticated
    USING (public.is_playlist_member(playlist_id));

-- Any member can add tracks; added_by MUST match the authenticated user (strict attribution integrity)
CREATE POLICY playlist_tracks_insert
    ON public.playlist_tracks
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_playlist_member(playlist_id)
        AND added_by = (SELECT auth.uid())
    );

-- Any member can reorder tracks (position)
CREATE POLICY playlist_tracks_update
    ON public.playlist_tracks
    FOR UPDATE
    TO authenticated
    USING (public.is_playlist_member(playlist_id))
    WITH CHECK (public.is_playlist_member(playlist_id));

-- The playlist owner can remove any track; editors can only remove tracks they added
CREATE POLICY playlist_tracks_delete
    ON public.playlist_tracks
    FOR DELETE
    TO authenticated
    USING (
        public.is_playlist_owner(playlist_id)
        OR added_by = (SELECT auth.uid())
    );

-- ==============================================================================
-- 6. Playlist Invitations Policies
-- ==============================================================================
-- Only the playlist owner can inspect pending invitations and hashes
CREATE POLICY playlist_invitations_select
    ON public.playlist_invitations
    FOR SELECT
    TO authenticated
    USING (public.is_playlist_owner(playlist_id));

-- Only the playlist owner can create an invitation for their playlist (enforcing 7-day max lifetime)
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

-- Direct UPDATEs on invitations are disallowed to prevent token reactivation, expiry extension,
-- or hash tampering. Acceptance is handled atomically by accept_playlist_invitation().
-- Revocation is performed by the owner via DELETE.

CREATE POLICY playlist_invitations_delete
    ON public.playlist_invitations
    FOR DELETE
    TO authenticated
    USING (public.is_playlist_owner(playlist_id));

-- ==============================================================================
-- 7. Table Grants and Privileges Lockdown
-- ==============================================================================
-- Defense-in-depth: Revoke all default table privileges from anon and PUBLIC
REVOKE ALL ON TABLE public.profiles, public.playlists, public.playlist_members, public.playlist_tracks, public.playlist_invitations FROM anon, PUBLIC;

-- Explicit minimal privileges for authenticated role
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.playlists TO authenticated;
GRANT SELECT, DELETE ON TABLE public.playlist_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.playlist_tracks TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.playlist_invitations TO authenticated;

/* ==========================================================================
   File: 20261024000006_track_verification_and_admin.sql
   ========================================================================== */

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

/* ==========================================================================
   File: 20261025000007_track_audio_storage.sql
   ========================================================================== */

-- Migration 7: Track Audio Storage and Playable Source Support
-- ORBIM Automated Music Audio Import
--
-- Security & Architecture Guarantees:
-- 1. Adds audio_url, storage_path, and audio_source_type to playlist_tracks.
-- 2. New columns default to safe values ('none' for audio_source_type, NULL for storage_path and audio_url).
-- 3. Check constraint enforces valid audio source types: 'none', 'storage', 'direct_stream', 'external_url'.
-- 4. Trigger protect_playlist_track_attribution is updated to preserve audio_url, storage_path, and audio_source_type
--    against unauthorized client mutations during track reordering or metadata updates.
-- 5. Storage policies for Supabase Storage bucket 'track-audio' are documented and provisioned:
--    - Public / authenticated read for playback streaming.
--    - Upload restricted to authorized operators (public.is_app_operator()) or administrators (public.is_app_admin()).
--    - Service-role key is never required on client side; operator credentials use least-privileged RLS.

-- ==============================================================================
-- 1. Extend playlist_tracks with Audio Source Columns
-- ==============================================================================

ALTER TABLE public.playlist_tracks
    ADD COLUMN IF NOT EXISTS audio_url TEXT,
    ADD COLUMN IF NOT EXISTS storage_path TEXT,
    ADD COLUMN IF NOT EXISTS audio_source_type TEXT NOT NULL DEFAULT 'none';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'track_audio_source_type_valid'
    ) THEN
        ALTER TABLE public.playlist_tracks
            ADD CONSTRAINT track_audio_source_type_valid
            CHECK (audio_source_type IN ('none', 'storage', 'direct_stream', 'external_url'));
    END IF;
END $$;

COMMENT ON COLUMN public.playlist_tracks.audio_url IS 'Direct URL or resolved public playback stream URL for audio playback.';
COMMENT ON COLUMN public.playlist_tracks.storage_path IS 'Supabase Storage relative object path in track-audio bucket.';
COMMENT ON COLUMN public.playlist_tracks.audio_source_type IS 'Origin classification of audio: none (metadata only), storage (Supabase Storage), direct_stream (authorized stream URL), external_url (informational link).';

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_audio_source_type
    ON public.playlist_tracks(audio_source_type);

-- ==============================================================================
-- 2. Update Attribution & Audio Integrity Protection Trigger
-- ==============================================================================
-- Ensures client UPDATEs (e.g. reordering positions) cannot tamper with audio_url,
-- storage_path, or audio_source_type.

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

    -- Preserved audio source integrity (cannot be swapped or cleared by client UPDATE)
    NEW.audio_url := OLD.audio_url;
    NEW.storage_path := OLD.storage_path;
    NEW.audio_source_type := OLD.audio_source_type;

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

DROP TRIGGER IF EXISTS on_playlist_track_update_protect ON public.playlist_tracks;
CREATE TRIGGER on_playlist_track_update_protect
    BEFORE UPDATE ON public.playlist_tracks
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_playlist_track_attribution();

-- ==============================================================================
-- 3. Storage Bucket & RLS Policies Setup Guide (Manual / Migration Reference)
-- ==============================================================================
-- Note: Supabase Storage bucket creation and policy management:
--
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES (
--     'track-audio',
--     'track-audio',
--     false, -- Hardened: Private bucket requiring signed URLs
--     52428800, -- 50 MB
--     ARRAY['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/mp4', 'audio/x-m4a', 'audio/flac']
-- ) ON CONFLICT (id) DO UPDATE SET public = false;
--
-- 1. SELECT Policy (Signed URL / HMAC download):
-- CREATE POLICY "track_audio_select_signed_v10"
--     ON storage.objects FOR SELECT
--     TO authenticated, anon
--     USING (bucket_id = 'track-audio');
--
-- 2. INSERT Policy (Upload requiring active registry reservation):
-- CREATE POLICY "track_audio_insert_reserved_v10"
--     ON storage.objects FOR INSERT
--     TO authenticated
--     WITH CHECK (
--         bucket_id = 'track-audio'
--         AND (
--             CASE 
--                 WHEN name ~ '^playlists/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.(mp3|wav|ogg|flac|m4a|aac)$'
--                 THEN public.is_playlist_editor(
--                     (regexp_match(name, '^playlists/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/'))[1]::uuid
--                 )
--                 ELSE false
--             END
--         )
--         AND public.has_active_upload_reservation(name)
--     );
--
-- 3. DELETE Policy (Restricted strictly to administrators):
-- CREATE POLICY "track_audio_delete_admin_only_v10"
--     ON storage.objects FOR DELETE
--     TO authenticated
--     USING (
--         bucket_id = 'track-audio'
--         AND public.is_app_admin()
--     );

/* ==========================================================================
   File: 20261031000008_storage_path_registry_and_lifecycle.sql
   ========================================================================== */

-- Migration 8: Storage Path Registry, Deletion Queue, Lifecycle Integrity & Anti-Deadlock Coordination
-- ORBIM Automated Music Audio Storage Lifecycle & Remote Reconciliation (Hardened v10)
--
-- Guarantees:
-- 1. Anti-Deadlock Parent-First Hierarchy:
--    L1 (playlists) -> L2 (storage_path_registry) -> L3 (playlist_tracks) -> L4 (storage_deletion_jobs)
-- 2. Never-Reuse Path Immutability:
--    Deleted paths are permanently tombstoned in storage_path_registry and can never be re-registered.
-- 3. Explicit Column State Constraint (chk_registry_state_columns):
--    Nullability of each registry column is strictly bound to its canonical lifecycle state.
-- 4. Worker Lease & Fencing Tokens:
--    Atomic claiming via FOR UPDATE SKIP LOCKED with monotonically increasing fencing tokens.
-- 5. Race-Free Orphan Sweeper & Adoption Protocol:
--    Exclusive ORPHAN_SWEEP_DELETING state blocks concurrent manual adoption during binary purge.

-- ==============================================================================
-- 1. Extend playlists Table with Decommissioning Support Columns
-- ==============================================================================

ALTER TABLE public.playlists
    ADD COLUMN IF NOT EXISTS is_decommissioned BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS decommissioned_at TIMESTAMPTZ;

COMMENT ON COLUMN public.playlists.is_decommissioned IS 'True if playlist has been decommissioned; blocks all new uploads and track additions.';
COMMENT ON COLUMN public.playlists.decommissioned_at IS 'Timestamp of when the playlist was marked for decommissioning.';

CREATE INDEX IF NOT EXISTS idx_playlists_decommissioned
    ON public.playlists(is_decommissioned)
    WHERE is_decommissioned = true;

-- ==============================================================================
-- 2. Authorization & RLS Helper Functions
-- ==============================================================================

-- Helper function: is_playlist_editor
CREATE OR REPLACE FUNCTION public.is_playlist_editor(p_playlist_id UUID)
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
          AND role IN ('owner', 'editor')
    );
$$;

COMMENT ON FUNCTION public.is_playlist_editor(UUID) IS 'Non-recursive security check determining if calling user is an editor or owner of a playlist.';

REVOKE ALL ON FUNCTION public.is_playlist_editor(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_playlist_editor(UUID) TO authenticated, service_role;

-- Helper function: has_active_upload_reservation (Hardened for RLS Evaluation)
CREATE OR REPLACE FUNCTION public.has_active_upload_reservation(
    p_storage_path text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1 
        FROM public.storage_path_registry AS spr
        WHERE spr.storage_path = p_storage_path
          AND spr.uploader_id = v_user_id
          AND spr.state = 'RESERVED_UPLOADING'
          AND spr.lease_expires_at > clock_timestamp()
    );
END;
$$;

COMMENT ON FUNCTION public.has_active_upload_reservation(text) IS 'Validates caller holds an active, unexpired upload reservation in storage_path_registry.';

REVOKE ALL ON FUNCTION public.has_active_upload_reservation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_active_upload_reservation(text) TO authenticated;

-- ==============================================================================
-- 3. Canonical Coordination Table: storage_path_registry
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.storage_path_registry (
    -- Immutable Historical Identity Columns
    storage_path text PRIMARY KEY,
    playlist_id uuid,
    track_id uuid,
    uploader_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),

    -- Mutable Lifecycle State Columns
    state text NOT NULL DEFAULT 'RESERVED_UPLOADING'
        CHECK (state IN (
            'RESERVED_UPLOADING',
            'COMMITTED',
            'CLEANUP_PENDING',
            'CLEANUP_COMPLETED',
            'DELETING',
            'DELETED_TOMBSTONE',
            'UNKNOWN_ORPHAN_QUARANTINED',
            'ORPHAN_SWEEP_DELETING'
        )),
    operation_type text
        CHECK (operation_type IN (
            'upload',
            'upload_cleanup',
            'track_deletion',
            'orphan_sweep'
        )),
    operation_id uuid,
    fencing_token bigint NOT NULL DEFAULT 1 CHECK (fencing_token >= 1),
    lease_holder text,
    lease_expires_at timestamptz,
    quarantine_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),

    -- Explicit Check Constraint Enforcing Valid Column Combinations per State
    CONSTRAINT chk_registry_state_columns CHECK (
        (state = 'RESERVED_UPLOADING' AND 
            playlist_id IS NOT NULL AND track_id IS NOT NULL AND uploader_id IS NOT NULL AND
            operation_type = 'upload' AND operation_id IS NOT NULL AND
            lease_holder IS NOT NULL AND lease_expires_at IS NOT NULL AND
            quarantine_until IS NULL)
        OR
        (state = 'COMMITTED' AND 
            playlist_id IS NOT NULL AND track_id IS NOT NULL AND uploader_id IS NOT NULL AND
            operation_type IS NULL AND operation_id IS NULL AND
            lease_holder IS NULL AND lease_expires_at IS NULL AND
            quarantine_until IS NULL)
        OR
        (state = 'CLEANUP_PENDING' AND 
            playlist_id IS NOT NULL AND track_id IS NOT NULL AND uploader_id IS NOT NULL AND
            operation_type = 'upload_cleanup' AND operation_id IS NOT NULL AND
            lease_holder IS NOT NULL AND lease_expires_at IS NOT NULL AND
            quarantine_until IS NULL)
        OR
        (state = 'CLEANUP_COMPLETED' AND 
            playlist_id IS NOT NULL AND track_id IS NOT NULL AND uploader_id IS NOT NULL AND
            operation_type = 'upload_cleanup' AND operation_id IS NOT NULL AND
            lease_holder IS NULL AND lease_expires_at IS NULL AND
            quarantine_until IS NULL)
        OR
        (state = 'DELETING' AND 
            playlist_id IS NOT NULL AND track_id IS NOT NULL AND uploader_id IS NOT NULL AND
            operation_type = 'track_deletion' AND operation_id IS NOT NULL AND
            quarantine_until IS NULL)
        OR
        (state = 'DELETED_TOMBSTONE' AND 
            playlist_id IS NOT NULL AND track_id IS NOT NULL AND uploader_id IS NOT NULL AND
            operation_type = 'track_deletion' AND operation_id IS NOT NULL AND
            lease_holder IS NULL AND lease_expires_at IS NULL AND
            quarantine_until IS NULL)
        OR
        (state = 'UNKNOWN_ORPHAN_QUARANTINED' AND 
            playlist_id IS NULL AND track_id IS NULL AND uploader_id IS NULL AND
            operation_type = 'orphan_sweep' AND operation_id IS NOT NULL AND
            lease_holder IS NULL AND lease_expires_at IS NULL AND
            quarantine_until IS NOT NULL)
        OR
        (state = 'ORPHAN_SWEEP_DELETING' AND 
            playlist_id IS NULL AND track_id IS NULL AND uploader_id IS NULL AND
            operation_type = 'orphan_sweep' AND operation_id IS NOT NULL AND
            lease_holder IS NOT NULL AND lease_expires_at IS NOT NULL AND
            quarantine_until IS NOT NULL)
    )
);

COMMENT ON TABLE public.storage_path_registry IS 'Unified coordination registry for audio storage paths, reservations, and permanent tombstones.';

CREATE INDEX IF NOT EXISTS idx_storage_path_registry_state_expires 
    ON public.storage_path_registry (state, lease_expires_at) 
    WHERE state IN ('RESERVED_UPLOADING', 'CLEANUP_PENDING', 'ORPHAN_SWEEP_DELETING');

CREATE INDEX IF NOT EXISTS idx_storage_path_registry_orphan_quarantine 
    ON public.storage_path_registry (quarantine_until) 
    WHERE state = 'UNKNOWN_ORPHAN_QUARANTINED';

CREATE INDEX IF NOT EXISTS idx_storage_path_registry_playlist 
    ON public.storage_path_registry (playlist_id) 
    WHERE playlist_id IS NOT NULL;

-- Trigger: Prevent DELETE or TRUNCATE on Registry (Audit Tombstone Immutability)
CREATE OR REPLACE FUNCTION public.prevent_storage_path_registry_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'CRITICAL INTEGRITY VIOLATION: storage_path_registry records are immutable audit tombstones and cannot be deleted or truncated. Storage path: %', OLD.storage_path;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_storage_path_registry_delete ON public.storage_path_registry;
CREATE TRIGGER trg_prevent_storage_path_registry_delete
    BEFORE DELETE OR TRUNCATE ON public.storage_path_registry
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.prevent_storage_path_registry_delete();

-- Trigger: Protect Historical Identity Columns & Enforce Fencing Monotonicity
CREATE OR REPLACE FUNCTION public.protect_registry_immutable_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
    IF NEW.storage_path IS DISTINCT FROM OLD.storage_path THEN
        RAISE EXCEPTION 'Immutable column violation: storage_path cannot be updated from % to %', 
            OLD.storage_path, NEW.storage_path;
    END IF;

    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Immutable column violation: created_at cannot be modified';
    END IF;

    IF OLD.uploader_id IS NOT NULL AND NEW.uploader_id IS DISTINCT FROM OLD.uploader_id THEN
        RAISE EXCEPTION 'Immutable column violation: uploader_id cannot be modified from % to %',
            OLD.uploader_id, NEW.uploader_id;
    END IF;

    IF OLD.playlist_id IS NOT NULL AND NEW.playlist_id IS DISTINCT FROM OLD.playlist_id THEN
        RAISE EXCEPTION 'Immutable column violation: playlist_id cannot be modified from % to %',
            OLD.playlist_id, NEW.playlist_id;
    END IF;

    IF OLD.track_id IS NOT NULL AND NEW.track_id IS DISTINCT FROM OLD.track_id THEN
        RAISE EXCEPTION 'Immutable column violation: track_id cannot be modified from % to %',
            OLD.track_id, NEW.track_id;
    END IF;

    IF NEW.fencing_token < OLD.fencing_token THEN
        RAISE EXCEPTION 'Fencing token violation: fencing_token cannot decrease (old: %, new: %)',
            OLD.fencing_token, NEW.fencing_token;
    END IF;

    IF OLD.state IN ('DELETED_TOMBSTONE', 'CLEANUP_COMPLETED') THEN
        RAISE EXCEPTION 'Tombstone violation: record in state % is terminal and permanently immutable', OLD.state;
    END IF;

    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_registry_immutable_columns ON public.storage_path_registry;
CREATE TRIGGER trg_protect_registry_immutable_columns
    BEFORE UPDATE ON public.storage_path_registry
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_registry_immutable_columns();

ALTER TABLE public.storage_path_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storage_path_registry FROM anon, authenticated, public;
GRANT SELECT, INSERT, UPDATE ON public.storage_path_registry TO service_role;
REVOKE DELETE, TRUNCATE ON public.storage_path_registry FROM service_role;

-- ==============================================================================
-- 4. Canonical Asynchronous Deletion Queue: storage_deletion_jobs
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.storage_deletion_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id text NOT NULL DEFAULT 'track-audio',
    storage_path text NOT NULL,
    playlist_id uuid,
    track_id uuid,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending',
            'processing',
            'completed',
            'failed',
            'dead_letter',
            'conflict_aborted'
        )),
    retry_count int NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    max_retries int NOT NULL DEFAULT 5 CHECK (max_retries > 0),
    next_retry_at timestamptz NOT NULL DEFAULT now(),
    fencing_token bigint NOT NULL DEFAULT 1 CHECK (fencing_token >= 1),
    lease_holder text,
    lease_expires_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);

COMMENT ON TABLE public.storage_deletion_jobs IS 'Asynchronous worker queue for distributed audio file deletion.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_deletion_job 
    ON public.storage_deletion_jobs (bucket_id, storage_path) 
    WHERE status IN ('pending', 'processing', 'failed');

CREATE INDEX IF NOT EXISTS idx_deletion_jobs_poll 
    ON public.storage_deletion_jobs (next_retry_at, lease_expires_at) 
    WHERE status IN ('pending', 'failed', 'processing');

CREATE INDEX IF NOT EXISTS idx_deletion_jobs_playlist_status 
    ON public.storage_deletion_jobs (playlist_id, status) 
    WHERE playlist_id IS NOT NULL;

ALTER TABLE public.storage_deletion_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storage_deletion_jobs FROM anon, authenticated, public;
GRANT SELECT, INSERT, UPDATE ON public.storage_deletion_jobs TO service_role;
REVOKE DELETE, TRUNCATE ON public.storage_deletion_jobs FROM service_role;

-- ==============================================================================
-- 5. Stored Procedures / RPCs (Parent-First Anti-Deadlock Hierarchy)
-- ==============================================================================

-- RPC-01: initiate_upload_reservation (L1 -> L2)
CREATE OR REPLACE FUNCTION public.initiate_upload_reservation(
    p_storage_path text,
    p_playlist_id uuid,
    p_track_id uuid,
    p_lease_seconds int DEFAULT 900
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_is_decommissioned boolean;
    v_operation_id uuid := gen_random_uuid();
    v_inserted boolean := false;
BEGIN
    IF v_caller_id IS NULL AND current_user != 'service_role' THEN
        RAISE EXCEPTION 'Authentication required to initiate upload reservation.';
    END IF;

    -- Level 1: Lock parent playlist row for KEY SHARE & verify active status
    SELECT is_decommissioned INTO v_is_decommissioned
    FROM public.playlists
    WHERE id = p_playlist_id
    FOR KEY SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Playlist % does not exist.', p_playlist_id;
    END IF;

    IF v_is_decommissioned THEN
        RAISE EXCEPTION 'Playlist % is decommissioned. Upload reservation rejected.', p_playlist_id;
    END IF;

    -- Authorize caller
    IF current_user != 'service_role' AND NOT public.is_playlist_editor(p_playlist_id) AND NOT public.is_app_admin() THEN
        RAISE EXCEPTION 'Permission denied: caller is not an editor of playlist %.', p_playlist_id;
    END IF;

    -- Level 2: Insert into storage_path_registry
    INSERT INTO public.storage_path_registry (
        storage_path,
        playlist_id,
        track_id,
        uploader_id,
        state,
        operation_type,
        operation_id,
        fencing_token,
        lease_holder,
        lease_expires_at,
        created_at,
        updated_at
    )
    VALUES (
        p_storage_path,
        p_playlist_id,
        p_track_id,
        coalesce(v_caller_id, gen_random_uuid()),
        'RESERVED_UPLOADING',
        'upload',
        v_operation_id,
        1,
        coalesce(v_caller_id::text, 'service_role'),
        clock_timestamp() + (p_lease_seconds * interval '1 second'),
        clock_timestamp(),
        clock_timestamp()
    )
    ON CONFLICT (storage_path) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF NOT v_inserted THEN
        RAISE EXCEPTION 'Storage path % already registered or reserved.', p_storage_path;
    END IF;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.initiate_upload_reservation(text, uuid, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.initiate_upload_reservation(text, uuid, uuid, int) TO authenticated, service_role;

-- RPC-02: renew_upload_reservation (L2)
CREATE OR REPLACE FUNCTION public.renew_upload_reservation(
    p_storage_path text,
    p_extension_seconds int DEFAULT 900
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_updated boolean := false;
BEGIN
    IF v_caller_id IS NULL AND current_user != 'service_role' THEN
        RAISE EXCEPTION 'Authentication required to renew upload reservation.';
    END IF;

    -- Level 2: Update lease_expires_at
    UPDATE public.storage_path_registry
    SET 
        lease_expires_at = clock_timestamp() + (p_extension_seconds * interval '1 second'),
        updated_at = clock_timestamp()
    WHERE storage_path = p_storage_path
      AND state = 'RESERVED_UPLOADING'
      AND (uploader_id = v_caller_id OR current_user = 'service_role' OR public.is_app_admin())
      AND lease_expires_at > clock_timestamp();

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF NOT v_updated THEN
        RAISE EXCEPTION 'Failed to renew upload reservation for path %: reservation expired, not found, or access denied.', p_storage_path;
    END IF;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.renew_upload_reservation(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renew_upload_reservation(text, int) TO authenticated, service_role;

-- RPC-03: commit_track_upload (L1 -> L2 -> L3)
CREATE OR REPLACE FUNCTION public.commit_track_upload(
    p_storage_path text,
    p_title text,
    p_artist_name text,
    p_album_name text DEFAULT NULL,
    p_duration_seconds int DEFAULT 0,
    p_position numeric DEFAULT NULL,
    p_artwork_url text DEFAULT NULL,
    p_provider text DEFAULT 'storage',
    p_provider_track_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_reg record;
    v_track_id uuid;
    v_final_position numeric;
    v_provider_track_id text;
BEGIN
    IF v_caller_id IS NULL AND current_user != 'service_role' THEN
        RAISE EXCEPTION 'Authentication required to commit track upload.';
    END IF;

    -- Read registry snapshot to determine target playlist
    SELECT playlist_id INTO v_reg
    FROM public.storage_path_registry
    WHERE storage_path = p_storage_path;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Storage path % is not reserved.', p_storage_path;
    END IF;

    -- Level 1: Lock parent playlist row FOR UPDATE (Anti-Deadlock Parent-First Rule)
    PERFORM 1
    FROM public.playlists
    WHERE id = v_reg.playlist_id
      AND is_decommissioned = false
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Playlist % does not exist or has been decommissioned.', v_reg.playlist_id;
    END IF;

    -- Level 2: Lock storage_path_registry FOR UPDATE
    SELECT * INTO v_reg
    FROM public.storage_path_registry
    WHERE storage_path = p_storage_path
    FOR UPDATE;

    IF v_reg.state != 'RESERVED_UPLOADING' THEN
        RAISE EXCEPTION 'Storage path % is not in RESERVED_UPLOADING state (current: %).', p_storage_path, v_reg.state;
    END IF;

    IF v_reg.lease_expires_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'Upload reservation for path % has expired.', p_storage_path;
    END IF;

    IF current_user != 'service_role' AND v_reg.uploader_id != v_caller_id AND NOT public.is_app_admin() THEN
        RAISE EXCEPTION 'Permission denied: caller is not the owner of this reservation.';
    END IF;

    -- Resolve track position
    IF p_position IS NOT NULL AND p_position > 0 THEN
        v_final_position := p_position;
    ELSE
        SELECT coalesce(max(position) + 1000.0, 1000.0) INTO v_final_position
        FROM public.playlist_tracks
        WHERE playlist_id = v_reg.playlist_id;
    END IF;

    v_provider_track_id := coalesce(p_provider_track_id, v_reg.track_id::text, gen_random_uuid()::text);

    -- Level 3: Insert into playlist_tracks (Trigger touch_playlist_updated_at executes without blocking because L1 is already locked)
    INSERT INTO public.playlist_tracks (
        id,
        playlist_id,
        provider,
        provider_track_id,
        title,
        artist_name,
        album_name,
        artwork_url,
        duration_seconds,
        position,
        added_by,
        added_at,
        added_via,
        verification_status,
        audio_url,
        storage_path,
        audio_source_type
    )
    VALUES (
        coalesce(v_reg.track_id, gen_random_uuid()),
        v_reg.playlist_id,
        coalesce(p_provider, 'storage'),
        v_provider_track_id,
        trim(p_title),
        trim(p_artist_name),
        p_album_name,
        p_artwork_url,
        greatest(p_duration_seconds, 0),
        v_final_position,
        v_reg.uploader_id,
        clock_timestamp(),
        'web_ui',
        'unverified',
        NULL,
        p_storage_path,
        'storage'
    )
    RETURNING id INTO v_track_id;

    -- Level 2: Update storage_path_registry to COMMITTED
    UPDATE public.storage_path_registry
    SET 
        state = 'COMMITTED',
        track_id = v_track_id,
        operation_type = NULL,
        operation_id = NULL,
        lease_holder = NULL,
        lease_expires_at = NULL,
        updated_at = clock_timestamp()
    WHERE storage_path = p_storage_path;

    RETURN v_track_id;
END;
$$;

REVOKE ALL ON FUNCTION public.commit_track_upload(text, text, text, text, int, numeric, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commit_track_upload(text, text, text, text, int, numeric, text, text, text) TO authenticated, service_role;

-- RPC-04: prepare_upload_cleanup (L2)
CREATE OR REPLACE FUNCTION public.prepare_upload_cleanup(
    p_storage_path text,
    p_operation_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_reg record;
    v_op_id uuid := coalesce(p_operation_id, gen_random_uuid());
BEGIN
    IF v_caller_id IS NULL AND current_user != 'service_role' THEN
        RAISE EXCEPTION 'Authentication required for cleanup.';
    END IF;

    -- Level 2: Lock registry row FOR UPDATE
    SELECT * INTO v_reg
    FROM public.storage_path_registry
    WHERE storage_path = p_storage_path
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Storage path % not found.', p_storage_path;
    END IF;

    IF v_reg.state != 'RESERVED_UPLOADING' THEN
        RAISE EXCEPTION 'Storage path % is not in RESERVED_UPLOADING state (current: %).', p_storage_path, v_reg.state;
    END IF;

    -- Verify not referenced in playlist_tracks
    IF EXISTS (SELECT 1 FROM public.playlist_tracks WHERE storage_path = p_storage_path) THEN
        RAISE EXCEPTION 'Storage path % is already committed to playlist_tracks; cleanup aborted.', p_storage_path;
    END IF;

    -- Check caller authorization (uploader, admin, or expired lease sweeper)
    IF current_user != 'service_role' AND NOT public.is_app_admin() THEN
        IF v_reg.uploader_id != v_caller_id AND v_reg.lease_expires_at > clock_timestamp() THEN
            RAISE EXCEPTION 'Permission denied: cannot clean up an active reservation belonging to another user.';
        END IF;
    END IF;

    -- Transition to CLEANUP_PENDING
    UPDATE public.storage_path_registry
    SET 
        state = 'CLEANUP_PENDING',
        operation_type = 'upload_cleanup',
        operation_id = v_op_id,
        lease_holder = coalesce(v_caller_id::text, 'service_role'),
        lease_expires_at = clock_timestamp() + interval '60 seconds',
        updated_at = clock_timestamp()
    WHERE storage_path = p_storage_path;

    RETURN v_op_id;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_upload_cleanup(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_upload_cleanup(text, uuid) TO authenticated, service_role;

-- RPC-05: finalize_upload_cleanup (L2)
CREATE OR REPLACE FUNCTION public.finalize_upload_cleanup(
    p_storage_path text,
    p_operation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_updated boolean := false;
BEGIN
    UPDATE public.storage_path_registry
    SET 
        state = 'CLEANUP_COMPLETED',
        lease_holder = NULL,
        lease_expires_at = NULL,
        updated_at = clock_timestamp()
    WHERE storage_path = p_storage_path
      AND state = 'CLEANUP_PENDING'
      AND operation_id = p_operation_id;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF NOT v_updated THEN
        RAISE EXCEPTION 'Failed to finalize cleanup for %: operation_id mismatch or not in CLEANUP_PENDING.', p_storage_path;
    END IF;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_upload_cleanup(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_upload_cleanup(text, uuid) TO authenticated, service_role;

-- RPC-06: initiate_track_deletion (L1 -> L2 -> L3 -> L4)
CREATE OR REPLACE FUNCTION public.initiate_track_deletion(
    p_track_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_track record;
    v_job_id uuid := gen_random_uuid();
    v_operation_id uuid := gen_random_uuid();
BEGIN
    IF v_caller_id IS NULL AND current_user != 'service_role' THEN
        RAISE EXCEPTION 'Authentication required to delete tracks.';
    END IF;

    -- Read track metadata
    SELECT id, playlist_id, storage_path INTO v_track
    FROM public.playlist_tracks
    WHERE id = p_track_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Track % not found in playlist_tracks.', p_track_id;
    END IF;

    -- Authorize caller
    IF current_user != 'service_role' AND NOT public.is_playlist_editor(v_track.playlist_id) AND NOT public.is_app_admin() THEN
        RAISE EXCEPTION 'Permission denied: caller cannot delete tracks from playlist %.', v_track.playlist_id;
    END IF;

    -- Level 1: Lock parent playlist row FOR UPDATE (Parent-First)
    PERFORM 1
    FROM public.playlists
    WHERE id = v_track.playlist_id
    FOR UPDATE;

    -- Level 2: Lock storage_path_registry FOR UPDATE if storage_path exists
    IF v_track.storage_path IS NOT NULL THEN
        PERFORM 1
        FROM public.storage_path_registry
        WHERE storage_path = v_track.storage_path
        FOR UPDATE;

        UPDATE public.storage_path_registry
        SET 
            state = 'DELETING',
            operation_type = 'track_deletion',
            operation_id = v_operation_id,
            updated_at = clock_timestamp()
        WHERE storage_path = v_track.storage_path;
    END IF;

    -- Level 3: Delete track from playlist_tracks (Trigger touch_playlist_updated_at executes without blocking)
    DELETE FROM public.playlist_tracks WHERE id = p_track_id;

    -- Level 4: Insert job into storage_deletion_jobs if storage_path exists
    IF v_track.storage_path IS NOT NULL THEN
        INSERT INTO public.storage_deletion_jobs (
            id,
            bucket_id,
            storage_path,
            playlist_id,
            track_id,
            status,
            fencing_token,
            created_at,
            updated_at
        )
        VALUES (
            v_job_id,
            'track-audio',
            v_track.storage_path,
            v_track.playlist_id,
            p_track_id,
            'pending',
            1,
            clock_timestamp(),
            clock_timestamp()
        )
        ON CONFLICT (bucket_id, storage_path) WHERE status IN ('pending', 'processing', 'failed')
        DO UPDATE SET
            status = 'pending',
            retry_count = 0,
            next_retry_at = clock_timestamp(),
            updated_at = clock_timestamp();
    END IF;

    RETURN v_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.initiate_track_deletion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.initiate_track_deletion(uuid) TO authenticated, service_role;

-- RPC-07: claim_deletion_jobs (L4)
CREATE OR REPLACE FUNCTION public.claim_deletion_jobs(
    p_worker_id text,
    p_batch_size int DEFAULT 10,
    p_lease_seconds int DEFAULT 60
)
RETURNS TABLE (
    job_id uuid,
    bucket_id text,
    storage_path text,
    playlist_id uuid,
    track_id uuid,
    fencing_token bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    -- Level 4 only: Claim pending or expired processing jobs using SKIP LOCKED
    RETURN QUERY
    WITH candidate_jobs AS (
        SELECT j.id
        FROM public.storage_deletion_jobs j
        WHERE (j.status = 'pending' AND j.next_retry_at <= clock_timestamp())
           OR (j.status = 'failed' AND j.next_retry_at <= clock_timestamp())
           OR (j.status = 'processing' AND j.lease_expires_at < clock_timestamp())
        ORDER BY j.next_retry_at ASC, j.created_at ASC
        LIMIT p_batch_size
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.storage_deletion_jobs upd
    SET 
        status = 'processing',
        lease_holder = p_worker_id,
        lease_expires_at = clock_timestamp() + (p_lease_seconds * interval '1 second'),
        fencing_token = upd.fencing_token + 1,
        updated_at = clock_timestamp()
    FROM candidate_jobs c
    WHERE upd.id = c.id
    RETURNING 
        upd.id,
        upd.bucket_id,
        upd.storage_path,
        upd.playlist_id,
        upd.track_id,
        upd.fencing_token;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_deletion_jobs(text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_deletion_jobs(text, int, int) TO service_role;

-- RPC-08: renew_deletion_job_lease (L4)
CREATE OR REPLACE FUNCTION public.renew_deletion_job_lease(
    p_job_id uuid,
    p_worker_id text,
    p_fencing_token bigint,
    p_extension_seconds int DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_updated boolean := false;
BEGIN
    -- Level 4 only: Extend lease if unexpired and token matches
    UPDATE public.storage_deletion_jobs
    SET 
        lease_expires_at = clock_timestamp() + (p_extension_seconds * interval '1 second'),
        updated_at = clock_timestamp()
    WHERE id = p_job_id
      AND status = 'processing'
      AND lease_holder = p_worker_id
      AND fencing_token = p_fencing_token
      AND lease_expires_at > clock_timestamp();

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF NOT v_updated THEN
        RAISE EXCEPTION 'Failed to renew lease for job %: lease expired, token mismatch, or job taken over.', p_job_id;
    END IF;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.renew_deletion_job_lease(uuid, text, bigint, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renew_deletion_job_lease(uuid, text, bigint, int) TO service_role;

-- RPC-09: complete_deletion_job (L2 -> L4)
CREATE OR REPLACE FUNCTION public.complete_deletion_job(
    p_job_id uuid,
    p_storage_path text,
    p_worker_id text,
    p_fencing_token bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_updated boolean := false;
BEGIN
    -- Level 2: Lock storage_path_registry FOR UPDATE first
    PERFORM 1
    FROM public.storage_path_registry
    WHERE storage_path = p_storage_path
    FOR UPDATE;

    -- Level 4: Lock storage_deletion_jobs FOR UPDATE
    UPDATE public.storage_deletion_jobs
    SET 
        status = 'completed',
        completed_at = clock_timestamp(),
        lease_holder = NULL,
        lease_expires_at = NULL,
        updated_at = clock_timestamp()
    WHERE id = p_job_id
      AND status = 'processing'
      AND lease_holder = p_worker_id
      AND fencing_token = p_fencing_token
      AND lease_expires_at > clock_timestamp();

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF NOT v_updated THEN
        RAISE EXCEPTION 'Stale worker detected on job %: token mismatch or lease expired. Completion rejected.', p_job_id;
    END IF;

    -- Level 2: Transition registry to DELETED_TOMBSTONE
    UPDATE public.storage_path_registry
    SET 
        state = 'DELETED_TOMBSTONE',
        lease_holder = NULL,
        lease_expires_at = NULL,
        updated_at = clock_timestamp()
    WHERE storage_path = p_storage_path;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_deletion_job(uuid, text, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_deletion_job(uuid, text, text, bigint) TO service_role;

-- RPC-10: fail_deletion_job (L4)
CREATE OR REPLACE FUNCTION public.fail_deletion_job(
    p_job_id uuid,
    p_worker_id text,
    p_fencing_token bigint,
    p_error_message text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_job record;
    v_new_retry int;
BEGIN
    -- Level 4 only
    SELECT * INTO v_job
    FROM public.storage_deletion_jobs
    WHERE id = p_job_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job % not found.', p_job_id;
    END IF;

    IF v_job.fencing_token != p_fencing_token OR v_job.lease_holder != p_worker_id THEN
        RAISE EXCEPTION 'Token or lease holder mismatch on job %.', p_job_id;
    END IF;

    v_new_retry := v_job.retry_count + 1;

    IF v_new_retry >= v_job.max_retries THEN
        UPDATE public.storage_deletion_jobs
        SET 
            status = 'dead_letter',
            retry_count = v_new_retry,
            last_error = p_error_message,
            lease_holder = NULL,
            lease_expires_at = NULL,
            updated_at = clock_timestamp()
        WHERE id = p_job_id;
    ELSE
        UPDATE public.storage_deletion_jobs
        SET 
            status = 'failed',
            retry_count = v_new_retry,
            next_retry_at = clock_timestamp() + (power(2, v_new_retry) * interval '5 seconds'),
            last_error = p_error_message,
            lease_holder = NULL,
            lease_expires_at = NULL,
            updated_at = clock_timestamp()
        WHERE id = p_job_id;
    END IF;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_deletion_job(uuid, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fail_deletion_job(uuid, text, bigint, text) TO service_role;

-- RPC-11: requeue_deletion_job (L2 -> L4)
CREATE OR REPLACE FUNCTION public.requeue_deletion_job(
    p_job_id uuid,
    p_storage_path text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    -- Level 2: Lock storage_path_registry FOR UPDATE first
    PERFORM 1
    FROM public.storage_path_registry
    WHERE storage_path = p_storage_path
    FOR UPDATE;

    -- Verify not referenced in playlist_tracks
    IF EXISTS (SELECT 1 FROM public.playlist_tracks WHERE storage_path = p_storage_path) THEN
        RAISE EXCEPTION 'Cannot requeue deletion for path %: active reference exists in playlist_tracks.', p_storage_path;
    END IF;

    -- Level 4: Lock and reset job in storage_deletion_jobs
    UPDATE public.storage_deletion_jobs
    SET 
        status = 'pending',
        retry_count = 0,
        next_retry_at = clock_timestamp(),
        lease_holder = NULL,
        lease_expires_at = NULL,
        last_error = 'Manually requeued by operator',
        updated_at = clock_timestamp()
    WHERE id = p_job_id
      AND status IN ('failed', 'dead_letter');

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.requeue_deletion_job(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.requeue_deletion_job(uuid, text) TO service_role;

-- RPC-12: evaluate_and_lock_orphan_candidate (L2)
CREATE OR REPLACE FUNCTION public.evaluate_and_lock_orphan_candidate(
    p_storage_path text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    -- Level 2: Insert into storage_path_registry as UNKNOWN_ORPHAN_QUARANTINED if not present
    INSERT INTO public.storage_path_registry (
        storage_path,
        state,
        operation_type,
        operation_id,
        fencing_token,
        quarantine_until,
        created_at,
        updated_at
    )
    VALUES (
        p_storage_path,
        'UNKNOWN_ORPHAN_QUARANTINED',
        'orphan_sweep',
        gen_random_uuid(),
        1,
        clock_timestamp() + interval '7 days',
        clock_timestamp(),
        clock_timestamp()
    )
    ON CONFLICT (storage_path) DO NOTHING;

    RETURN 'QUARANTINED';
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_and_lock_orphan_candidate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_and_lock_orphan_candidate(text) TO service_role;

-- RPC-13: claim_orphan_sweep_job (L2)
CREATE OR REPLACE FUNCTION public.claim_orphan_sweep_job(
    p_storage_path text,
    p_worker_id text,
    p_lease_seconds int DEFAULT 60
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_token bigint;
BEGIN
    -- Level 2: Lock orphan candidate row
    SELECT fencing_token + 1 INTO v_token
    FROM public.storage_path_registry
    WHERE storage_path = p_storage_path
      AND state = 'UNKNOWN_ORPHAN_QUARANTINED'
      AND quarantine_until <= clock_timestamp()
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Candidate % is not eligible for sweep (not in quarantine or quarantine unexpired).', p_storage_path;
    END IF;

    UPDATE public.storage_path_registry
    SET 
        state = 'ORPHAN_SWEEP_DELETING',
        lease_holder = p_worker_id,
        lease_expires_at = clock_timestamp() + (p_lease_seconds * interval '1 second'),
        fencing_token = v_token,
        operation_id = gen_random_uuid(),
        updated_at = clock_timestamp()
    WHERE storage_path = p_storage_path;

    RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_orphan_sweep_job(text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_orphan_sweep_job(text, text, int) TO service_role;

-- RPC-14: finalize_orphan_sweep (L2)
CREATE OR REPLACE FUNCTION public.finalize_orphan_sweep(
    p_storage_path text,
    p_worker_id text,
    p_fencing_token bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_updated boolean := false;
BEGIN
    -- Level 2
    UPDATE public.storage_path_registry
    SET 
        state = 'DELETED_TOMBSTONE',
        lease_holder = NULL,
        lease_expires_at = NULL,
        updated_at = clock_timestamp()
    WHERE storage_path = p_storage_path
      AND state = 'ORPHAN_SWEEP_DELETING'
      AND lease_holder = p_worker_id
      AND fencing_token = p_fencing_token
      AND lease_expires_at > clock_timestamp();

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF NOT v_updated THEN
        RAISE EXCEPTION 'Failed to finalize orphan sweep for %: token mismatch, lease expired, or invalid state.', p_storage_path;
    END IF;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_orphan_sweep(text, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_orphan_sweep(text, text, bigint) TO service_role;

-- RPC-15: fail_orphan_sweep_job (L2)
CREATE OR REPLACE FUNCTION public.fail_orphan_sweep_job(
    p_storage_path text,
    p_worker_id text,
    p_fencing_token bigint,
    p_error_message text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    UPDATE public.storage_path_registry
    SET 
        state = 'UNKNOWN_ORPHAN_QUARANTINED',
        quarantine_until = clock_timestamp() + interval '10 minutes',
        lease_holder = NULL,
        lease_expires_at = NULL,
        updated_at = clock_timestamp()
    WHERE storage_path = p_storage_path
      AND state = 'ORPHAN_SWEEP_DELETING'
      AND lease_holder = p_worker_id
      AND fencing_token = p_fencing_token;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_orphan_sweep_job(text, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fail_orphan_sweep_job(text, text, bigint, text) TO service_role;

-- RPC-16: adopt_quarantined_orphan (L1 -> L2 -> L3)
CREATE OR REPLACE FUNCTION public.adopt_quarantined_orphan(
    p_storage_path text,
    p_target_playlist_id uuid,
    p_title text,
    p_artist_name text,
    p_album_name text DEFAULT NULL,
    p_duration_seconds int DEFAULT 0,
    p_position numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_track_id uuid := gen_random_uuid();
    v_final_position numeric;
    v_reg record;
BEGIN
    IF v_caller_id IS NULL AND current_user != 'service_role' THEN
        RAISE EXCEPTION 'Authentication required to adopt orphan.';
    END IF;

    -- Authorize caller on target playlist
    IF current_user != 'service_role' AND NOT public.is_playlist_editor(p_target_playlist_id) AND NOT public.is_app_admin() THEN
        RAISE EXCEPTION 'Permission denied: caller is not an editor of playlist %.', p_target_playlist_id;
    END IF;

    -- Level 1: Lock target playlist FOR UPDATE (Parent-First)
    PERFORM 1
    FROM public.playlists
    WHERE id = p_target_playlist_id
      AND is_decommissioned = false
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target playlist % not found or decommissioned.', p_target_playlist_id;
    END IF;

    -- Level 2: Lock orphan candidate row FOR UPDATE
    SELECT * INTO v_reg
    FROM public.storage_path_registry
    WHERE storage_path = p_storage_path
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Orphan path % not found in registry.', p_storage_path;
    END IF;

    IF v_reg.state != 'UNKNOWN_ORPHAN_QUARANTINED' THEN
        RAISE EXCEPTION 'Cannot adopt orphan: path % is in % state (must be UNKNOWN_ORPHAN_QUARANTINED).', p_storage_path, v_reg.state;
    END IF;

    -- Position calculation
    IF p_position IS NOT NULL AND p_position > 0 THEN
        v_final_position := p_position;
    ELSE
        SELECT coalesce(max(position) + 1000.0, 1000.0) INTO v_final_position
        FROM public.playlist_tracks
        WHERE playlist_id = p_target_playlist_id;
    END IF;

    -- Level 3: Insert into playlist_tracks (Trigger touch_playlist_updated_at executes without blocking)
    INSERT INTO public.playlist_tracks (
        id,
        playlist_id,
        provider,
        provider_track_id,
        title,
        artist_name,
        album_name,
        artwork_url,
        duration_seconds,
        position,
        added_by,
        added_at,
        added_via,
        verification_status,
        audio_url,
        storage_path,
        audio_source_type
    )
    VALUES (
        v_track_id,
        p_target_playlist_id,
        'storage',
        v_track_id::text,
        trim(p_title),
        trim(p_artist_name),
        p_album_name,
        NULL,
        greatest(p_duration_seconds, 0),
        v_final_position,
        v_caller_id,
        clock_timestamp(),
        'web_ui',
        'unverified',
        NULL,
        p_storage_path,
        'storage'
    );

    -- Level 2: Transition registry to COMMITTED
    UPDATE public.storage_path_registry
    SET 
        state = 'COMMITTED',
        playlist_id = p_target_playlist_id,
        track_id = v_track_id,
        uploader_id = coalesce(v_caller_id, gen_random_uuid()),
        operation_type = NULL,
        operation_id = NULL,
        quarantine_until = NULL,
        lease_holder = NULL,
        lease_expires_at = NULL,
        updated_at = clock_timestamp()
    WHERE storage_path = p_storage_path;

    RETURN v_track_id;
END;
$$;

REVOKE ALL ON FUNCTION public.adopt_quarantined_orphan(text, uuid, text, text, text, int, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adopt_quarantined_orphan(text, uuid, text, text, text, int, numeric) TO authenticated, service_role;

-- RPC-17: decommission_playlist (L1 -> L2 -> L3 -> L4)
CREATE OR REPLACE FUNCTION public.decommission_playlist(
    p_playlist_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_track_count int := 0;
BEGIN
    IF v_caller_id IS NULL AND current_user != 'service_role' THEN
        RAISE EXCEPTION 'Authentication required to decommission playlist.';
    END IF;

    -- Authorize caller (owner or admin)
    IF current_user != 'service_role' AND NOT public.is_playlist_owner(p_playlist_id) AND NOT public.is_app_admin() THEN
        RAISE EXCEPTION 'Permission denied: only playlist owner or platform admin can decommission playlist %.', p_playlist_id;
    END IF;

    -- Level 1: Lock playlist row FOR UPDATE
    PERFORM 1
    FROM public.playlists
    WHERE id = p_playlist_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Playlist % not found.', p_playlist_id;
    END IF;

    -- Mark playlist decommissioned to block any concurrent upload reservations
    UPDATE public.playlists
    SET 
        is_decommissioned = true,
        decommissioned_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE id = p_playlist_id;

    -- Level 2: Lock all associated paths in storage_path_registry FOR UPDATE
    PERFORM 1
    FROM public.storage_path_registry
    WHERE playlist_id = p_playlist_id
      AND state IN ('RESERVED_UPLOADING', 'COMMITTED')
    FOR UPDATE;

    -- Level 4: Enqueue all active storage tracks into storage_deletion_jobs
    INSERT INTO public.storage_deletion_jobs (
        bucket_id,
        storage_path,
        playlist_id,
        track_id,
        status,
        created_at,
        updated_at
    )
    SELECT 
        'track-audio',
        pt.storage_path,
        p_playlist_id,
        pt.id,
        'pending',
        clock_timestamp(),
        clock_timestamp()
    FROM public.playlist_tracks pt
    WHERE pt.playlist_id = p_playlist_id
      AND pt.storage_path IS NOT NULL
    ON CONFLICT (bucket_id, storage_path) WHERE status IN ('pending', 'processing', 'failed')
    DO NOTHING;

    -- Level 2: Update all active paths to DELETING
    UPDATE public.storage_path_registry
    SET 
        state = 'DELETING',
        operation_type = 'track_deletion',
        operation_id = gen_random_uuid(),
        updated_at = clock_timestamp()
    WHERE playlist_id = p_playlist_id
      AND state IN ('RESERVED_UPLOADING', 'COMMITTED');

    -- Level 3: Remove tracks from playlist_tracks (Trigger touch_playlist_updated_at executes without blocking)
    DELETE FROM public.playlist_tracks
    WHERE playlist_id = p_playlist_id;

    GET DIAGNOSTICS v_track_count = ROW_COUNT;

    RETURN v_track_count;
END;
$$;

REVOKE ALL ON FUNCTION public.decommission_playlist(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decommission_playlist(uuid) TO authenticated, service_role;

-- RPC-18: finalize_playlist_decommission (L1 -> L4)
CREATE OR REPLACE FUNCTION public.finalize_playlist_decommission(
    p_playlist_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_caller_id uuid := auth.uid();
    v_pending_count int := 0;
BEGIN
    IF v_caller_id IS NULL AND current_user != 'service_role' THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    IF current_user != 'service_role' AND NOT public.is_playlist_owner(p_playlist_id) AND NOT public.is_app_admin() THEN
        RAISE EXCEPTION 'Permission denied.';
    END IF;

    -- Level 1: Lock playlist row FOR UPDATE
    PERFORM 1
    FROM public.playlists
    WHERE id = p_playlist_id
      AND is_decommissioned = true
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Playlist % not found or not decommissioned.', p_playlist_id;
    END IF;

    -- Level 4: Check if any deletion jobs for this playlist are not completed
    SELECT count(*) INTO v_pending_count
    FROM public.storage_deletion_jobs
    WHERE playlist_id = p_playlist_id
      AND status != 'completed';

    IF v_pending_count > 0 THEN
        RAISE EXCEPTION 'Cannot finalize playlist %: % deletion jobs still active, failed, or dead-lettered.', p_playlist_id, v_pending_count;
    END IF;

    -- Delete playlist row (Historical registry tombstones are preserved forever)
    DELETE FROM public.playlists
    WHERE id = p_playlist_id;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_playlist_decommission(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_playlist_decommission(uuid) TO authenticated, service_role;

/* ==========================================================================
   File: 20261101000008_global_music_catalog.sql
   ========================================================================== */

-- Migration 8: Global Music Catalog, Publication Workflow & Admin Audio Upload
-- ORBIM Automated Music Platform Architecture

CREATE TABLE IF NOT EXISTS public.catalog_tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL DEFAULT 'spotify',
    provider_track_id TEXT NOT NULL,
    title TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    album_name TEXT,
    artwork_url TEXT,
    duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
    storage_path TEXT,
    audio_url TEXT,
    audio_source_type TEXT NOT NULL DEFAULT 'none' CHECK (audio_source_type IN ('none', 'storage', 'direct_stream', 'external_url')),
    publication_status TEXT NOT NULL DEFAULT 'draft' CHECK (publication_status IN ('draft', 'published', 'unpublished')),
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    published_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    CONSTRAINT catalog_tracks_provider_unique UNIQUE (provider, provider_track_id),
    CONSTRAINT catalog_tracks_published_integrity CHECK (
        (publication_status = 'published' AND storage_path IS NOT NULL AND audio_url IS NOT NULL AND published_by IS NOT NULL AND published_at IS NOT NULL)
        OR (publication_status != 'published')
    )
);

COMMENT ON TABLE public.catalog_tracks IS 'Canonical global music catalog managed exclusively by platform administrators.';
COMMENT ON COLUMN public.catalog_tracks.storage_path IS 'Canonical path in Supabase Storage bucket track-audio.';
COMMENT ON COLUMN public.catalog_tracks.publication_status IS 'Lifecycle state: draft (unpublished working copy), published (visible to all users), unpublished (withdrawn).';

CREATE INDEX IF NOT EXISTS idx_catalog_tracks_status 
    ON public.catalog_tracks (publication_status);

CREATE INDEX IF NOT EXISTS idx_catalog_tracks_provider 
    ON public.catalog_tracks (provider, provider_track_id);

CREATE INDEX IF NOT EXISTS idx_catalog_tracks_created_by 
    ON public.catalog_tracks (created_by);

ALTER TABLE public.playlist_tracks
    ADD COLUMN IF NOT EXISTS catalog_track_id UUID REFERENCES public.catalog_tracks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_catalog_track_id
    ON public.playlist_tracks(catalog_track_id);

ALTER TABLE public.catalog_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_tracks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_tracks_select_policy ON public.catalog_tracks;
CREATE POLICY catalog_tracks_select_policy
    ON public.catalog_tracks
    FOR SELECT
    TO authenticated
    USING (
        publication_status = 'published'
        OR public.is_app_admin()
    );

DROP POLICY IF EXISTS catalog_tracks_insert_admin ON public.catalog_tracks;
CREATE POLICY catalog_tracks_insert_admin
    ON public.catalog_tracks
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_app_admin()
    );

DROP POLICY IF EXISTS catalog_tracks_update_admin ON public.catalog_tracks;
CREATE POLICY catalog_tracks_update_admin
    ON public.catalog_tracks
    FOR UPDATE
    TO authenticated
    USING (public.is_app_admin())
    WITH CHECK (public.is_app_admin());

DROP POLICY IF EXISTS catalog_tracks_delete_admin ON public.catalog_tracks;
CREATE POLICY catalog_tracks_delete_admin
    ON public.catalog_tracks
    FOR DELETE
    TO authenticated
    USING (public.is_app_admin());

CREATE OR REPLACE FUNCTION public.publish_catalog_track(
    p_track_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_track RECORD;
    v_now TIMESTAMPTZ := now();
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required: caller is not signed in';
    END IF;

    IF NOT public.is_app_admin() THEN
        RAISE EXCEPTION 'Access denied: caller (%) is not a Platform Administrator', v_caller_id;
    END IF;

    SELECT id, title, storage_path, audio_url, publication_status
    INTO v_track
    FROM public.catalog_tracks
    WHERE id = p_track_id
    FOR UPDATE;

    IF v_track.id IS NULL THEN
        RAISE EXCEPTION 'Catalog track not found: %', p_track_id;
    END IF;

    IF v_track.storage_path IS NULL OR trim(v_track.storage_path) = '' THEN
        RAISE EXCEPTION 'Cannot publish track without an uploaded audio storage path: %', p_track_id;
    END IF;

    IF v_track.audio_url IS NULL OR trim(v_track.audio_url) = '' THEN
        RAISE EXCEPTION 'Cannot publish track without an active audio URL: %', p_track_id;
    END IF;

    UPDATE public.catalog_tracks
    SET
        publication_status = 'published',
        published_at = v_now,
        published_by = v_caller_id,
        updated_at = v_now
    WHERE id = p_track_id;

    RETURN jsonb_build_object(
        'status', 'success',
        'track_id', p_track_id,
        'publication_status', 'published',
        'published_at', v_now,
        'published_by', v_caller_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_catalog_track(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_catalog_track(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.unpublish_catalog_track(
    p_track_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_now TIMESTAMPTZ := now();
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required: caller is not signed in';
    END IF;

    IF NOT public.is_app_admin() THEN
        RAISE EXCEPTION 'Access denied: caller (%) is not a Platform Administrator', v_caller_id;
    END IF;

    UPDATE public.catalog_tracks
    SET
        publication_status = 'unpublished',
        updated_at = v_now
    WHERE id = p_track_id;

    RETURN jsonb_build_object(
        'status', 'success',
        'track_id', p_track_id,
        'publication_status', 'unpublished',
        'updated_at', v_now
    );
END;
$$;

REVOKE ALL ON FUNCTION public.unpublish_catalog_track(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unpublish_catalog_track(UUID) TO authenticated, service_role;



/* ==========================================================================
   File: 20261101000009_recently_added_catalog_index.sql
   ========================================================================== */

-- ==============================================================================
-- Home "Recently added" — catalog read path
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_catalog_tracks_recently_added
    ON public.catalog_tracks (published_at DESC)
    WHERE publication_status = 'published'
      AND storage_path IS NOT NULL;

COMMENT ON INDEX public.idx_catalog_tracks_recently_added IS
    'Backs the Home "Recently added" query: newest published catalog tracks with stored audio.';

/* ==========================================================================
   File: 20261102000010_collaborative_playlist_invitations.sql
   ========================================================================== */

-- Migration 10: Collaborative Playlist Invitations (Lifecycle, Username Targeting & Idempotent Acceptance)
-- ORBIM Collaborative Architecture

-- 1. Extend public.playlist_invitations with invitee_id, status, and responded_at
ALTER TABLE public.playlist_invitations
    ADD COLUMN IF NOT EXISTS invitee_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;

-- 2. Constraints for status validity and invitation targeting
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'invitation_status_valid'
    ) THEN
        ALTER TABLE public.playlist_invitations
            ADD CONSTRAINT invitation_status_valid
            CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired'));
    END IF;
END $$;

-- Allow token_hash to be nullable for username-addressed invitations
ALTER TABLE public.playlist_invitations
    ALTER COLUMN token_hash DROP NOT NULL;

-- Update token_hash format constraint to allow null
ALTER TABLE public.playlist_invitations
    DROP CONSTRAINT IF EXISTS invitation_token_hash_format;

ALTER TABLE public.playlist_invitations
    ADD CONSTRAINT invitation_token_hash_format
    CHECK (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$');

-- Ensure at least one targeting mechanism is present (link token or recipient account)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'invitation_target_valid'
    ) THEN
        ALTER TABLE public.playlist_invitations
            ADD CONSTRAINT invitation_target_valid
            CHECK (token_hash IS NOT NULL OR invitee_id IS NOT NULL);
    END IF;
END $$;

-- Backfill existing rows to consistent lifecycle status
UPDATE public.playlist_invitations
SET status = 'accepted'
WHERE accepted_at IS NOT NULL AND status = 'pending';

UPDATE public.playlist_invitations
SET status = 'expired'
WHERE expires_at <= now() AND accepted_at IS NULL AND status = 'pending';

-- 3. Indexes for recipient inbox query performance and duplicate prevention
CREATE INDEX IF NOT EXISTS idx_playlist_invitations_invitee
    ON public.playlist_invitations(invitee_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_user_invitation
    ON public.playlist_invitations (playlist_id, invitee_id)
    WHERE status = 'pending';

-- 4. Update Row Level Security Policies on playlist_invitations
-- Allow playlist owner OR intended recipient to view invitations
DROP POLICY IF EXISTS playlist_invitations_select ON public.playlist_invitations;
CREATE POLICY playlist_invitations_select
    ON public.playlist_invitations
    FOR SELECT
    TO authenticated
    USING (
        public.is_playlist_owner(playlist_id)
        OR invitee_id = (SELECT auth.uid())
    );

-- Allow playlist owner to create invitations (cannot invite oneself)
DROP POLICY IF EXISTS playlist_invitations_insert ON public.playlist_invitations;
CREATE POLICY playlist_invitations_insert
    ON public.playlist_invitations
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_playlist_owner(playlist_id)
        AND created_by = (SELECT auth.uid())
        AND expires_at > now()
        AND expires_at <= now() + interval '7 days'
        AND (invitee_id IS NULL OR invitee_id <> (SELECT auth.uid()))
    );

-- Owner can revoke (delete) invitations
DROP POLICY IF EXISTS playlist_invitations_delete ON public.playlist_invitations;
CREATE POLICY playlist_invitations_delete
    ON public.playlist_invitations
    FOR DELETE
    TO authenticated
    USING (public.is_playlist_owner(playlist_id));

GRANT SELECT, INSERT, DELETE ON TABLE public.playlist_invitations TO authenticated;

-- 5. Stored Procedure: Atomic Token-Based Invitation Acceptance (Hardened & Idempotent)
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
    -- 1. Validate caller authentication
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required: must be signed in to accept a playlist invitation.'
            USING ERRCODE = 'ORB01';
    END IF;

    -- 2. Validate token parameter format
    IF p_token IS NULL OR char_length(trim(p_token)) < 16 THEN
        RAISE EXCEPTION 'Invalid invitation format: token is missing or malformed.'
            USING ERRCODE = 'ORB02';
    END IF;

    -- 3. Compute SHA-256 lowercase hex hash of the normalized token
    v_token_hash := encode(sha256(convert_to(lower(trim(p_token)), 'UTF8')), 'hex');

    -- 4. Query and lock the invitation row
    SELECT id, playlist_id, role, expires_at, accepted_at, status, invitee_id
    INTO v_invitation
    FROM public.playlist_invitations
    WHERE token_hash = v_token_hash
    FOR UPDATE;

    IF v_invitation.id IS NULL THEN
        RAISE EXCEPTION 'Invitation not found or token is invalid.'
            USING ERRCODE = 'ORB03';
    END IF;

    -- 5. Check target playlist exists
    SELECT id, title, visibility, owner_id
    INTO v_playlist
    FROM public.playlists
    WHERE id = v_invitation.playlist_id;

    IF v_playlist.id IS NULL THEN
        RAISE EXCEPTION 'The target playlist for this invitation no longer exists.'
            USING ERRCODE = 'ORB06';
    END IF;

    -- 6. EXISTING MEMBER CHECK BEFORE REPLAY CHECK!
    -- Owner previewing link safely returns already_member without burning token
    IF v_caller_id = v_playlist.owner_id THEN
        RETURN jsonb_build_object(
            'status', 'already_member',
            'playlist_id', v_invitation.playlist_id,
            'playlist_title', v_playlist.title,
            'role', 'owner'
        );
    END IF;

    -- Check if caller is already a member
    SELECT role INTO v_existing_role
    FROM public.playlist_members
    WHERE playlist_id = v_invitation.playlist_id
      AND user_id = v_caller_id;

    IF v_existing_role IS NOT NULL THEN
        IF v_invitation.accepted_at IS NULL THEN
            UPDATE public.playlist_invitations
            SET accepted_at = now(),
                responded_at = now(),
                status = 'accepted'
            WHERE id = v_invitation.id;
        END IF;

        RETURN jsonb_build_object(
            'status', 'already_member',
            'playlist_id', v_invitation.playlist_id,
            'playlist_title', v_playlist.title,
            'role', v_existing_role
        );
    END IF;

    -- 7. Account mismatch check if invitation was targeted
    IF v_invitation.invitee_id IS NOT NULL AND v_invitation.invitee_id <> v_caller_id THEN
        RAISE EXCEPTION 'This invitation is addressed to another ORBIM account.'
            USING ERRCODE = 'ORB11';
    END IF;

    -- 8. Replay protection: Token was accepted by someone else
    IF v_invitation.accepted_at IS NOT NULL OR v_invitation.status = 'accepted' THEN
        RAISE EXCEPTION 'This invitation has already been accepted and is no longer valid.'
            USING ERRCODE = 'ORB04';
    END IF;

    -- 9. Status & Expiration checks
    IF v_invitation.status = 'revoked' THEN
        RAISE EXCEPTION 'This invitation has been revoked by the playlist owner.'
            USING ERRCODE = 'ORB09';
    END IF;

    IF v_invitation.status = 'declined' THEN
        RAISE EXCEPTION 'This invitation was declined.'
            USING ERRCODE = 'ORB10';
    END IF;

    IF v_invitation.expires_at <= now() OR v_invitation.status = 'expired' THEN
        UPDATE public.playlist_invitations
        SET status = 'expired'
        WHERE id = v_invitation.id AND status = 'pending';

        RAISE EXCEPTION 'This invitation has expired.'
            USING ERRCODE = 'ORB05';
    END IF;

    -- 10. Atomic mutation: Consume invitation and grant editor membership
    UPDATE public.playlist_invitations
    SET accepted_at = now(),
        responded_at = now(),
        status = 'accepted'
    WHERE id = v_invitation.id;

    INSERT INTO public.playlist_members (playlist_id, user_id, role, joined_at)
    VALUES (v_invitation.playlist_id, v_caller_id, v_invitation.role, now())
    ON CONFLICT (playlist_id, user_id) DO NOTHING;

    -- Promote playlist to 'shared' and touch updated_at
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

-- 6. Stored Procedure: Atomic Acceptance by Invitation ID (for Recipient Inbox)
CREATE OR REPLACE FUNCTION public.accept_playlist_invitation_by_id(p_invitation_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_invitation RECORD;
    v_playlist RECORD;
    v_existing_role TEXT;
BEGIN
    -- 1. Validate caller authentication
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required: must be signed in to accept a playlist invitation.'
            USING ERRCODE = 'ORB01';
    END IF;

    -- 2. Validate invitation parameter
    IF p_invitation_id IS NULL THEN
        RAISE EXCEPTION 'Invalid invitation format: ID is missing.'
            USING ERRCODE = 'ORB02';
    END IF;

    -- 3. Query and lock the invitation row
    SELECT id, playlist_id, role, expires_at, accepted_at, status, invitee_id
    INTO v_invitation
    FROM public.playlist_invitations
    WHERE id = p_invitation_id
    FOR UPDATE;

    IF v_invitation.id IS NULL THEN
        RAISE EXCEPTION 'Invitation not found.'
            USING ERRCODE = 'ORB03';
    END IF;

    -- 4. Verify recipient ownership
    IF v_invitation.invitee_id IS NOT NULL AND v_invitation.invitee_id <> v_caller_id THEN
        RAISE EXCEPTION 'Unauthorized: this invitation is addressed to another ORBIM account.'
            USING ERRCODE = 'ORB11';
    END IF;

    -- 5. Verify target playlist exists
    SELECT id, title, visibility, owner_id
    INTO v_playlist
    FROM public.playlists
    WHERE id = v_invitation.playlist_id;

    IF v_playlist.id IS NULL THEN
        RAISE EXCEPTION 'The target playlist for this invitation no longer exists.'
            USING ERRCODE = 'ORB06';
    END IF;

    -- 6. Check existing membership
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
        IF v_invitation.status = 'pending' THEN
            UPDATE public.playlist_invitations
            SET accepted_at = now(),
                responded_at = now(),
                status = 'accepted'
            WHERE id = v_invitation.id;
        END IF;

        RETURN jsonb_build_object(
            'status', 'already_member',
            'playlist_id', v_invitation.playlist_id,
            'playlist_title', v_playlist.title,
            'role', v_existing_role
        );
    END IF;

    -- 7. Verify status is pending
    IF v_invitation.status = 'accepted' THEN
        RETURN jsonb_build_object(
            'status', 'already_member',
            'playlist_id', v_invitation.playlist_id,
            'playlist_title', v_playlist.title,
            'role', v_invitation.role
        );
    ELSIF v_invitation.status = 'revoked' THEN
        RAISE EXCEPTION 'This invitation has been revoked by the playlist owner.'
            USING ERRCODE = 'ORB09';
    ELSIF v_invitation.status = 'declined' THEN
        RAISE EXCEPTION 'This invitation was declined.'
            USING ERRCODE = 'ORB10';
    END IF;

    -- 8. Verify expiration
    IF v_invitation.expires_at <= now() THEN
        UPDATE public.playlist_invitations
        SET status = 'expired'
        WHERE id = v_invitation.id;

        RAISE EXCEPTION 'This invitation has expired.'
            USING ERRCODE = 'ORB05';
    END IF;

    -- 9. Atomic mutation
    UPDATE public.playlist_invitations
    SET accepted_at = now(),
        responded_at = now(),
        status = 'accepted'
    WHERE id = v_invitation.id;

    INSERT INTO public.playlist_members (playlist_id, user_id, role, joined_at)
    VALUES (v_invitation.playlist_id, v_caller_id, v_invitation.role, now())
    ON CONFLICT (playlist_id, user_id) DO NOTHING;

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

-- 7. Stored Procedure: Atomic Decline by Invitation ID (for Recipient Inbox)
CREATE OR REPLACE FUNCTION public.decline_playlist_invitation(p_invitation_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_invitation RECORD;
BEGIN
    -- 1. Validate caller authentication
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required: must be signed in to decline a playlist invitation.'
            USING ERRCODE = 'ORB01';
    END IF;

    -- 2. Validate invitation parameter
    IF p_invitation_id IS NULL THEN
        RAISE EXCEPTION 'Invalid invitation format: ID is missing.'
            USING ERRCODE = 'ORB02';
    END IF;

    -- 3. Query and lock the invitation row
    SELECT id, playlist_id, invitee_id, status
    INTO v_invitation
    FROM public.playlist_invitations
    WHERE id = p_invitation_id
    FOR UPDATE;

    IF v_invitation.id IS NULL THEN
        RAISE EXCEPTION 'Invitation not found.'
            USING ERRCODE = 'ORB03';
    END IF;

    -- 4. Verify recipient ownership
    IF v_invitation.invitee_id IS NOT NULL AND v_invitation.invitee_id <> v_caller_id THEN
        RAISE EXCEPTION 'Unauthorized: this invitation is addressed to another ORBIM account.'
            USING ERRCODE = 'ORB11';
    END IF;

    -- 5. If already declined, return idempotent success
    IF v_invitation.status = 'declined' THEN
        RETURN jsonb_build_object(
            'status', 'declined',
            'invitation_id', v_invitation.id
        );
    END IF;

    IF v_invitation.status = 'accepted' THEN
        RAISE EXCEPTION 'Cannot decline an invitation that has already been accepted.'
            USING ERRCODE = 'ORB13';
    END IF;

    -- 6. Update status to declined (no membership is created)
    UPDATE public.playlist_invitations
    SET status = 'declined',
        responded_at = now()
    WHERE id = v_invitation.id;

    RETURN jsonb_build_object(
        'status', 'declined',
        'invitation_id', v_invitation.id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_playlist_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_playlist_invitation(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.accept_playlist_invitation_by_id(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_playlist_invitation_by_id(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.decline_playlist_invitation(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decline_playlist_invitation(UUID) TO authenticated;

-- 8. Stored Procedure: Preview Invitation Details Safely (for Invite Page)
CREATE OR REPLACE FUNCTION public.preview_playlist_invitation(p_token TEXT)
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
    v_inviter RECORD;
    v_existing_role TEXT;
BEGIN
    IF p_token IS NULL OR char_length(trim(p_token)) < 16 THEN
        RETURN jsonb_build_object('valid', false, 'error_kind', 'invalid');
    END IF;

    v_token_hash := encode(sha256(convert_to(lower(trim(p_token)), 'UTF8')), 'hex');

    SELECT id, playlist_id, role, expires_at, accepted_at, status, invitee_id, created_by
    INTO v_invitation
    FROM public.playlist_invitations
    WHERE token_hash = v_token_hash;

    IF v_invitation.id IS NULL THEN
        RETURN jsonb_build_object('valid', false, 'error_kind', 'invalid');
    END IF;

    SELECT id, title, visibility, owner_id
    INTO v_playlist
    FROM public.playlists
    WHERE id = v_invitation.playlist_id;

    IF v_playlist.id IS NULL THEN
        RETURN jsonb_build_object('valid', false, 'error_kind', 'invalid');
    END IF;

    SELECT id, display_name, avatar_url
    INTO v_inviter
    FROM public.profiles
    WHERE id = v_invitation.created_by;

    -- Check if caller is already a member or owner
    IF v_caller_id IS NOT NULL THEN
        IF v_caller_id = v_playlist.owner_id THEN
            RETURN jsonb_build_object(
                'valid', true,
                'status', 'already_member',
                'playlist_id', v_invitation.playlist_id,
                'playlist_title', v_playlist.title,
                'inviter_name', coalesce(v_inviter.display_name, 'Pemilik Playlist'),
                'role', 'owner'
            );
        END IF;

        SELECT role INTO v_existing_role
        FROM public.playlist_members
        WHERE playlist_id = v_invitation.playlist_id
          AND user_id = v_caller_id;

        IF v_existing_role IS NOT NULL THEN
            RETURN jsonb_build_object(
                'valid', true,
                'status', 'already_member',
                'playlist_id', v_invitation.playlist_id,
                'playlist_title', v_playlist.title,
                'inviter_name', coalesce(v_inviter.display_name, 'Pemilik Playlist'),
                'role', v_existing_role
            );
        END IF;
    END IF;

    -- If addressed to another account
    IF v_caller_id IS NOT NULL AND v_invitation.invitee_id IS NOT NULL AND v_invitation.invitee_id <> v_caller_id THEN
        RETURN jsonb_build_object(
            'valid', false,
            'error_kind', 'wrong_account',
            'playlist_title', v_playlist.title
        );
    END IF;

    -- Replay / consumed check
    IF v_invitation.accepted_at IS NOT NULL OR v_invitation.status = 'accepted' THEN
        RETURN jsonb_build_object(
            'valid', false,
            'error_kind', 'already_accepted',
            'playlist_title', v_playlist.title
        );
    END IF;

    IF v_invitation.status = 'revoked' THEN
        RETURN jsonb_build_object('valid', false, 'error_kind', 'revoked');
    END IF;

    IF v_invitation.status = 'declined' THEN
        RETURN jsonb_build_object('valid', false, 'error_kind', 'declined');
    END IF;

    IF v_invitation.expires_at <= now() OR v_invitation.status = 'expired' THEN
        RETURN jsonb_build_object('valid', false, 'error_kind', 'expired');
    END IF;

    RETURN jsonb_build_object(
        'valid', true,
        'status', 'pending',
        'playlist_id', v_invitation.playlist_id,
        'playlist_title', v_playlist.title,
        'inviter_name', coalesce(v_inviter.display_name, 'Pemilik Playlist'),
        'role', v_invitation.role,
        'expires_at', v_invitation.expires_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.preview_playlist_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_playlist_invitation(TEXT) TO authenticated, anon;
