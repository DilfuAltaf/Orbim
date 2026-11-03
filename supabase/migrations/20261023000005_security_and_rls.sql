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
