import { createClient as createAdmin } from '@supabase/supabase-js'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Caches real Anthropic API responses for the demo tenant only (see
// lib/demo-entities.ts) so replaying the scripted product tour doesn't
// re-spend real API credits on every run. The FIRST real run for a given
// cache key always calls Claude for real and records the response; every
// later run with the same key replays it instead of calling the API again.
// Callers gate access to this by org id themselves (typically
// `org_id === DEMO_ORG_ID` or membership in `DEMO_ALL_ORG_IDS`) — nothing
// here decides who's eligible, so a caller that never passes a cache key
// never touches this table and real customers are unaffected.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getCachedAiResponse(cacheKey: string): Promise<any | null> {
  try {
    const { data } = await adminClient
      .from('demo_ai_cache')
      .select('response')
      .eq('cache_key', cacheKey)
      .maybeSingle()
    return data?.response ?? null
  } catch {
    return null
  }
}

// Fire-and-forget — never let a caching write slow down or break a real
// chat reply / negotiation decision.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setCachedAiResponse(cacheKey: string, response: any): void {
  void Promise.resolve(
    adminClient
      .from('demo_ai_cache')
      .upsert({ cache_key: cacheKey, response }, { onConflict: 'cache_key' })
  ).catch(() => {})
}
