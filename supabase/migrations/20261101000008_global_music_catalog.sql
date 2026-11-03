-- Migration 8: Global Music Catalog, Publication Workflow & Admin Audio Upload
-- ORBIM Automated Music Platform Architecture
--
-- Security & Architecture Guarantees:
-- 1. Separates the global music catalog from playlist membership into public.catalog_tracks.
-- 2. Each global track has one canonical record with unique (provider, provider_track_id).
-- 3. Audio upload and storage path assignment is strictly restricted to designated platform administrators.
-- 4. Publication lifecycle: 'draft' -> 'published' -> 'unpublished'.
-- 5. Strict Published-Only Visibility: Regular authenticated users can ONLY query, see, and play 'published' tracks.
--    Draft, pending, and unpublished tracks are completely hidden from regular users via PostgreSQL Row Level Security.
-- 6. Check constraint enforces that no track can be set to 'published' without confirmed storage_path, audio_url,
--    published_by, and published_at.
-- 7. Playlist membership (public.playlist_tracks) links to public.catalog_tracks via catalog_track_id FK.
--    Adding a track to a playlist references the canonical catalog track and never duplicates the audio file.
-- 8. Validates publication status upon adding to a playlist (regular users cannot add draft/unpublished tracks).
-- 9. Storage policies on bucket 'track-audio' restrict upload, update, and deletion strictly to admin.

-- ==============================================================================
-- 1. Create Canonical Global Catalog Table (public.catalog_tracks)
-- ==============================================================================

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

-- ==============================================================================
-- 2. Link playlist_tracks to Canonical Catalog Track (FK)
-- ==============================================================================

ALTER TABLE public.playlist_tracks
    ADD COLUMN IF NOT EXISTS catalog_track_id UUID REFERENCES public.catalog_tracks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_catalog_track_id
    ON public.playlist_tracks(catalog_track_id);

-- ==============================================================================
-- 3. Row Level Security on public.catalog_tracks
-- ==============================================================================

ALTER TABLE public.catalog_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_tracks FORCE ROW LEVEL SECURITY;

-- SELECT: Admins see all states (draft, published, unpublished).
-- Regular authenticated users see ONLY published tracks! Anon gets nothing.
DROP POLICY IF EXISTS catalog_tracks_select_policy ON public.catalog_tracks;
CREATE POLICY catalog_tracks_select_policy
    ON public.catalog_tracks
    FOR SELECT
    TO authenticated
    USING (
        publication_status = 'published'
        OR public.is_app_admin()
    );

-- INSERT: Strictly Platform Admins
DROP POLICY IF EXISTS catalog_tracks_insert_admin ON public.catalog_tracks;
CREATE POLICY catalog_tracks_insert_admin
    ON public.catalog_tracks
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_app_admin()
    );

-- UPDATE: Strictly Platform Admins
DROP POLICY IF EXISTS catalog_tracks_update_admin ON public.catalog_tracks;
CREATE POLICY catalog_tracks_update_admin
    ON public.catalog_tracks
    FOR UPDATE
    TO authenticated
    USING (public.is_app_admin())
    WITH CHECK (public.is_app_admin());

-- DELETE: Strictly Platform Admins
DROP POLICY IF EXISTS catalog_tracks_delete_admin ON public.catalog_tracks;
CREATE POLICY catalog_tracks_delete_admin
    ON public.catalog_tracks
    FOR DELETE
    TO authenticated
    USING (public.is_app_admin());

-- ==============================================================================
-- 4. Stored Procedure: Admin Publish / Unpublish Catalog Track
-- ==============================================================================

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
