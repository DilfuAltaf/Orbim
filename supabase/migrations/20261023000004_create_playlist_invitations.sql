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
