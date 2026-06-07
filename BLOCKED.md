# BLOCKED

_No active blockers._

## RESOLVED

### T1.2 — Generate baseline schema + RLS migration from live Supabase

**Resolved 2026-06-07.** The original blocker stood: `supabase db dump` was never
usable here — `apps/web/.env.local` only holds REST-layer secrets (the service-role key
is a PostgREST JWT, not a Postgres password), there is no `config.toml` / linked project,
and Docker was not running for a local `supabase start`.

**How it was unblocked:** the user authenticated the **Supabase MCP server** (`/mcp`),
which provides authenticated `execute_sql` access to the project. The baseline was
reconstructed directly from the system catalogs (`pg_get_constraintdef`,
`pg_get_functiondef`, `pg_get_triggerdef`, `pg_policies`, `pg_attribute`, …) rather than
`pg_dump`, and written to:

- `supabase/migrations/00000000000000_baseline_schema.sql`
- `supabase/migrations/00000000000001_baseline_rls.sql`

To regenerate after schema changes, re-run the catalog dump through the Supabase MCP
(see TASKS.md T1.2). Track 2 (`supabase gen types`) is now unblocked.
