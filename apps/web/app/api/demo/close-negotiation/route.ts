import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { assertDemoRoutesEnabled, isDemoAccount } from '@/lib/demo'
import { DEMO_ALL_ORG_IDS } from '@/lib/demo-entities'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/demo/close-negotiation — force-closes any still-'active' demo
// tenant negotiation the instant Scene 7 (DemoAgentActivityFeed) finishes
// with it, rather than leaving it 'active' until the next Replay (which
// deletes it via /api/demo/reset). The real pg_cron tick job ticks EVERY
// 'active' agent_negotiations row platform-wide once a minute regardless of
// origin — an abandoned demo negotiation sitting 'active' between viewings
// would keep getting real Sonnet calls (and spending real credits) for as
// long as nobody happens to replay the tour again. Called on both a normal
// completion and an early skip/unmount, so nothing demo-created is ever
// left ticking unattended.
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

  const { data: closed } = await adminClient
    .from('agent_negotiations')
    .update({ status: 'completed_withdrawn', halt_requested: true })
    .in('org_id', DEMO_ALL_ORG_IDS)
    .in('status', ['active', 'awaiting_finalization'])
    .select('id')

  return NextResponse.json({ closed: closed?.length ?? 0 })
}
