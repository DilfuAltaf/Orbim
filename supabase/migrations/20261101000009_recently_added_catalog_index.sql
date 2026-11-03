-- ==============================================================================
-- Home "Recently added" — catalog read path
-- ==============================================================================
-- The Home section lists the newest PUBLISHED catalog tracks that actually have
-- stored audio, ordered by the real publication timestamp:
--
--   SELECT * FROM public.catalog_tracks
--   WHERE publication_status = 'published'
--     AND storage_path IS NOT NULL
--   ORDER BY published_at DESC
--   LIMIT ... OFFSET ...
--
-- A partial index keeps that query cheap as the catalog grows, while remaining
-- limited to rows anonymous/authenticated readers may already see through the
-- existing published-only SELECT policy. No policy, column or data change is
-- introduced here.

CREATE INDEX IF NOT EXISTS idx_catalog_tracks_recently_added
    ON public.catalog_tracks (published_at DESC)
    WHERE publication_status = 'published'
      AND storage_path IS NOT NULL;

COMMENT ON INDEX public.idx_catalog_tracks_recently_added IS
    'Backs the Home "Recently added" query: newest published catalog tracks with stored audio.';
