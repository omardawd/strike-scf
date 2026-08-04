-- Caches real Anthropic API responses for the demo tenant (demo@demo.com)
-- so replaying the scripted cinematic product tour doesn't re-spend real API
-- credits on every run. Service-role only — never read or written by an
-- anon/authenticated client directly, only via the admin client from
-- lib/ai/demo-ai-cache.ts. See that file for the caching strategy.
create table if not exists public.demo_ai_cache (
  cache_key text primary key,
  response jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.demo_ai_cache enable row level security;
-- No policies: RLS enabled with zero grants blocks all anon/authenticated
-- access by default; only the service-role admin client (which bypasses RLS
-- entirely) ever touches this table.
