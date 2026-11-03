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
