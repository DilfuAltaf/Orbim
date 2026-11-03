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
