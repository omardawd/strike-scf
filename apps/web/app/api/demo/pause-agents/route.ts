import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { assertDemoRoutesEnabled, isDemoAccount } from '@/lib/demo'
import { DEMO_ALL_ORG_IDS } from '@/lib/demo-entities'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/demo/pause-agents — demo-only. Deactivates every demo org's
// autonomous agent immediately after Scene 6's execute step submits a real
// offer, closing the race window as early as possible — /api/demo/mock-
// negotiate's own tick-loop silencing (see that route's doc comment) only
// takes effect once IT starts running, which is several seconds later (the
// "It's triggering a negotiation..." narration + scene-transition pause).
// The real pg_cron tick fires every 60s against this same tenant, and left
// active even for those few seconds, can have the counterparty's agent
// genuinely react to the fresh offer via runListingDefenseTick before the
// deterministic negotiation route ever gets to it — concretely observed:
// a real round landed mid-scene and collided with mock-negotiate's own
// first move. Reactivated by mock-negotiate's own `finally` block once the
// deterministic run completes.
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

  await adminClient.from('org_agents').update({ is_active: false }).in('org_id', DEMO_ALL_ORG_IDS)
  return NextResponse.json({ ok: true })
}
