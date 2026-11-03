-- Migration 10: Stored Procedure to Add Collaborator by User ID
-- Allows playlist owners to add collaborators directly by their profile ID.

CREATE OR REPLACE FUNCTION public.add_playlist_collaborator(
    p_playlist_id UUID,
    p_collaborator_id UUID,
    p_role TEXT DEFAULT 'editor'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_is_owner BOOLEAN;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = 'ORB01';
    END IF;

    -- Only the playlist owner can directly add a collaborator
    SELECT (owner_id = v_caller_id) INTO v_is_owner
    FROM public.playlists
    WHERE id = p_playlist_id;

    IF v_is_owner IS NOT TRUE THEN
        RAISE EXCEPTION 'Only the playlist owner can add collaborators.' USING ERRCODE = 'ORB03';
    END IF;

    -- Ensure collaborator exists in profiles
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_collaborator_id) THEN
        RAISE EXCEPTION 'Collaborator profile not found.' USING ERRCODE = 'ORB04';
    END IF;

    -- Insert or ignore if already member
    INSERT INTO public.playlist_members (playlist_id, user_id, role, joined_at)
    VALUES (p_playlist_id, p_collaborator_id, coalesce(p_role, 'editor'), now())
    ON CONFLICT (playlist_id, user_id) DO UPDATE SET role = EXCLUDED.role;

    RETURN jsonb_build_object('success', true, 'playlist_id', p_playlist_id, 'collaborator_id', p_collaborator_id);
END;
$$;

REVOKE ALL ON FUNCTION public.add_playlist_collaborator(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_playlist_collaborator(UUID, UUID, TEXT) TO authenticated, service_role;
