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
