import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { runAgentScan } from '@/lib/ai/agent-scan'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Called by: org_admin via settings page ("Run scan now") or Vercel cron (daily 07:00 UTC)
export async function POST(req: NextRequest) {
  // Check if this is a Vercel cron call (no session)
  const cronSecret = req.headers.get('x-cron-secret')
  const isCron = cronSecret === process.env.CRON_SECRET

  if (isCron) {
    // Run scan for ALL active orgs
    const { data: activeAgents } = await adminClient
      .from('org_agents')
      .select('org_id')
      .eq('is_active', true)

    const results: Array<{ org_id: string; inserted: number }> = []

    for (const row of activeAgents ?? []) {
      const result = await runAgentScan(row.org_id).catch(() => ({ inserted: 0, proposals: [] }))
      results.push({ org_id: row.org_id, inserted: result.inserted })
    }

    const total = results.reduce((sum, r) => sum + r.inserted, 0)
    return NextResponse.json({ scanned: results.length, total_proposals: total, results })
  }

  // Manual trigger from org_admin
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

  const result = await runAgentScan(userData.org_id)
  return NextResponse.json({
    inserted: result.inserted,
    proposals: result.proposals.map((p) => ({ type: p.type, title: p.title })),
    message: result.inserted
      ? `Scan complete — ${result.inserted} new proposal${result.inserted === 1 ? '' : 's'} ready for review.`
      : 'Scan complete — no new proposals at this time.',
  })
}
