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
