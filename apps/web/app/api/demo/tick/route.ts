import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { assertDemoRoutesEnabled, isDemoAccount } from '@/lib/demo'
import { runAgentTick, runListingDefenseTick } from '@/lib/ai/agent-tick'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/demo/tick — demo-only accelerated negotiation tick, called
// repeatedly by DemoAgentActivityFeed (Scene 7) instead of waiting on
// pg_cron's once-a-minute cadence. The real, session-scoped
// POST /api/agents/tick only ticks the CALLER's own org (both
// runAgentTick(orgId) and runListingDefenseTick(orgId) filter to it) — fine
// for a human checking their own negotiation, but useless here: Harborview
// (the demo login) made the opening offer, so it's the COUNTERPARTY's
// (Ironbridge's) turn to respond first, and Ironbridge has no session in
// this demo. Only the unscoped path (both functions called with no orgId,
// exactly what the real pg_cron job does every minute in production) ticks
// both sides. Gated to the demo account so this unscoped, no-secret-required
// trigger can't be used to force-tick arbitrary orgs' real negotiations.
export async function POST() {
  const disabled = assertDemoRoutesEnabled()
  if (disabled) return disabled

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, email')
    .eq('id', user.id)
    .single()
  if (!me || !isDemoAccount(me.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // A short claim window (vs. the real 90s default) — safe here specifically
  // because this route is the only thing driving this pace, against an
  // isolated, single-negotiation demo tenant. See tickOne's doc comment.
  const [outbound, defense] = await Promise.all([runAgentTick(undefined, 3000), runListingDefenseTick()])
  return NextResponse.json({ processed: outbound.processed + defense.processed })
}
