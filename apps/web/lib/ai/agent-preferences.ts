// Shared loader for org_agents guardrail preferences (agent_preferences table).
// These 9 preference types are persisted via Settings → Agent but, before this
// feature, were never read anywhere else — agent-scan.ts didn't bound its
// proposals with them and nothing enforced them at execution time. Both
// agent-scan.ts (to bound what Claude proposes) and the tick route (to
// enforce guardrails on autonomous negotiation) call this one function so the
// read logic — and the "is anything actually configured" answer — only exists
// once.
import { createClient as createAdmin } from '@supabase/supabase-js'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export type AgentPreferenceType =
  | 'rate_floor'
  | 'rate_ceiling'
  | 'min_passport_score'
  | 'auto_reject_below_score'
  | 'max_deal_value_auto'
  | 'preferred_tenor_days'
  | 'blacklist_countries'
  | 'preferred_incoterms'
  | 'max_financing_rate'

export interface AgentPreferences {
  rate_floor: number | null
  rate_ceiling: number | null
  min_passport_score: number | null
  auto_reject_below_score: number | null
  max_deal_value_auto: number | null
  preferred_tenor_days: number | null
  blacklist_countries: string[]
  preferred_incoterms: string[]
  max_financing_rate: number | null
  /** True if the org has actively configured at least one price/value guardrail
   *  (rate_floor, rate_ceiling, or max_deal_value_auto). Structural caps
   *  (max_rounds, deadline) are NOT part of this — those always apply
   *  regardless, purely to bound runaway loops, not as a business guardrail. */
  hasPriceGuardrails: boolean
}

const EMPTY: AgentPreferences = {
  rate_floor: null,
  rate_ceiling: null,
  min_passport_score: null,
  auto_reject_below_score: null,
  max_deal_value_auto: null,
  preferred_tenor_days: null,
  blacklist_countries: [],
  preferred_incoterms: [],
  max_financing_rate: null,
  hasPriceGuardrails: false,
}

export async function getAgentPreferences(orgId: string): Promise<AgentPreferences> {
  const { data } = await adminClient
    .from('agent_preferences')
    .select('preference_type, value, is_active')
    .eq('org_id', orgId)
    .eq('is_active', true)

  if (!data || data.length === 0) return { ...EMPTY }

  const prefs: AgentPreferences = { ...EMPTY }
  for (const row of data as Array<{ preference_type: AgentPreferenceType; value: unknown }>) {
    switch (row.preference_type) {
      case 'rate_floor': prefs.rate_floor = Number(row.value) || null; break
      case 'rate_ceiling': prefs.rate_ceiling = Number(row.value) || null; break
      case 'min_passport_score': prefs.min_passport_score = Number(row.value); break
      case 'auto_reject_below_score': prefs.auto_reject_below_score = Number(row.value); break
      case 'max_deal_value_auto': prefs.max_deal_value_auto = Number(row.value) || null; break
      case 'preferred_tenor_days': prefs.preferred_tenor_days = Number(row.value) || null; break
      case 'blacklist_countries': prefs.blacklist_countries = Array.isArray(row.value) ? row.value as string[] : []; break
      case 'preferred_incoterms': prefs.preferred_incoterms = Array.isArray(row.value) ? row.value as string[] : []; break
      case 'max_financing_rate': prefs.max_financing_rate = Number(row.value) || null; break
    }
  }

  prefs.hasPriceGuardrails = prefs.rate_floor != null || prefs.rate_ceiling != null || prefs.max_deal_value_auto != null
  return prefs
}
