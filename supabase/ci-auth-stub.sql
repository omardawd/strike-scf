-- Minimal stand-in for the parts of Supabase's platform-managed `auth`
-- schema that this repo's migrations and seed.sql reference (auth.users,
-- auth.identities, auth.uid()). This is NOT a reimplementation of Supabase
-- Auth — it exists solely so `supabase/migrations/*.sql` and `seed.sql` can
-- be validated against a plain Postgres instance in CI and in local dev,
-- since neither the Supabase CLI nor Docker is assumed to be available
-- everywhere this repo is worked on.
--
-- Used by .github/workflows/ci.yml's "Validate database schema" job and by
-- scripts/db-validate.sh for the same check locally. If you add a migration
-- that depends on more of the `auth` schema (or on `storage`/`net`/`cron`,
-- which Supabase also manages), extend this file rather than special-casing
-- it in the workflow.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  confirmation_token text,
  recovery_token text,
  email_change_token_new text,
  email_change text
);

CREATE TABLE IF NOT EXISTS auth.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  provider_id text,
  identity_data jsonb,
  provider text,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  UNIQUE (provider_id, provider)
);

-- The real auth.uid() reads the JWT claims of the current request; there is
-- no request context outside the Supabase platform, so this stub always
-- returns NULL. RLS policies that depend on auth.uid() are exercised in
-- application-level tests (Vitest/Playwright against a real Supabase
-- project), not by this schema-shape validation.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULL::uuid
$$;

-- 00000000000033_enable_realtime_publication_tables.sql expects this to
-- already exist (Supabase creates it by default on every project).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;

-- 00000000000000_baseline_schema.sql creates pgcrypto/uuid-ossp in the
-- `extensions` schema (Supabase's convention) and then calls their functions
-- (uuid_generate_v4(), gen_random_uuid(), etc.) unqualified throughout —
-- requires `extensions` on the session search_path to resolve. Uses
-- current_database() rather than a hardcoded name so this stub works
-- against any target database name.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET search_path TO public, extensions', current_database());
END
$$;
