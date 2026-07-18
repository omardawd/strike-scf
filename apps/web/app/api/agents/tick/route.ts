import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { runAgentTick, runListingDefenseTick } from '@/lib/ai/agent-tick'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Runs both halves of autonomous negotiation: the GATE-1-approved side
// (runAgentTick) and the listing-owner side that never went through a
// per-negotiation plan (runListingDefenseTick) — see the doc comment on
// runListingDefenseTick for why both are required for a negotiation to
// actually move on its own from both directions.
async function runBothTicks(orgId?: string) {
  const [outbound, defense] = await Promise.all([
    runAgentTick(orgId),
    runListingDefenseTick(orgId),
  ])
  return {
    processed: outbound.processed + defense.processed,
    results: [...outbound.results, ...defense.results],
  }
}

// Vercel cron: every 5 minutes. Auth: x-cron-secret header (same convention as
// /api/deals/check-overdue, /api/risk/refresh-signals, /api/erp/sync).
async function handleCron(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runBothTicks()
  return NextResponse.json(result)
}

export async function GET(req: NextRequest) {
  return handleCron(req)
}

// POST supports both the cron secret (for manual curl testing without waiting
// for the schedule) and an org_admin session (scoped to their own org only —
// used to manually verify a negotiation is progressing without needing cron access).
export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret')
  if (cronSecret === process.env.CRON_SECRET) {
    const result = await runBothTicks()
    return NextResponse.json(result)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, org_id, role')
    .eq('id', user.id)
    .single()

  if (!userData?.org_id) return NextResponse.json({ error: 'No org' }, { status: 400 })
  if (userData.role !== 'org_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const result = await runBothTicks(userData.org_id)
  return NextResponse.json(result)
}
