# BLOCKED

## T1.2 — Generate baseline schema + RLS migration from live Supabase

**Status:** Blocked — missing DB credentials / no dump target.

**What the task needs:** `npx supabase db dump --schema public` plus an RLS policy
dump from the live Supabase project, committed as baseline migrations.

**Why it's blocked:**
- `supabase db dump` requires a Postgres connection (either a linked project via
  `supabase link` + DB password, or `--db-url postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres`).
- `apps/web/.env.local` only contains REST-layer secrets: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. The service-role key is
  a PostgREST JWT, **not** a Postgres password — it cannot authenticate `pg_dump`.
- No `supabase/config.toml` and no linked project ref (`supabase/.temp/project-ref` absent).
- Docker daemon is not running, so a local `supabase start` instance can't be used as a dump source.
- RLS policies are not exposed over the PostgREST API, so the RLS dump (T1.2 step 4) is
  impossible without direct DB access regardless.

**To unblock (any one of these):**
1. Provide the DB connection string / password so `supabase db dump --db-url ...` can run, **or**
2. Run `npx supabase login` + `npx supabase link --project-ref <ref>` interactively
   (the project ref is the subdomain of `NEXT_PUBLIC_SUPABASE_URL`), then re-run T1.2, **or**
3. Start Docker + `npx supabase start` if a local schema source is acceptable.

**Impact:** Track 1 is not "fully committed" until T1.2 lands. Track 2 (which depends on
this dump for `supabase gen types`) cannot start. T1.1, T1.3, T1.4, T1.5 are unaffected
and have been completed.
