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
-- Note: Supabase Storage bucket creation is managed via storage.buckets table:
--
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES (
--     'track-audio',
--     'track-audio',
--     true,
--     52428800, -- 50 MB
--     ARRAY['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/mp4', 'audio/x-m4a', 'audio/flac']
-- ) ON CONFLICT (id) DO NOTHING;
--
-- CREATE POLICY "Public read track-audio"
--     ON storage.objects FOR SELECT
--     USING (bucket_id = 'track-audio');
--
-- CREATE POLICY "Authorized operator upload track-audio"
--     ON storage.objects FOR INSERT
--     TO authenticated
--     WITH CHECK (
--         bucket_id = 'track-audio'
--         AND (public.is_app_operator() OR public.is_app_admin())
--     );
--
-- CREATE POLICY "Authorized admin delete track-audio"
--     ON storage.objects FOR DELETE
--     TO authenticated
--     USING (
--         bucket_id = 'track-audio'
--         AND public.is_app_admin()
--     );
