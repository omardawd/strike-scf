import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { assertDemoRoutesEnabled, isDemoAccount } from '@/lib/demo'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/demo/negotiation-status?rootTaskId=<uuid> — demo-only cross-org negotiation status
// check. The real per-thread messages route (/api/agents/tasks/[id]/messages) only ever shows
// tasks belonging to the CALLER's own org's thread — correct in production. But GATE-2
// finalization can be recommended from either side of a negotiation (see runListingDefenseTick
// in lib/ai/agent-tick.ts): when the counterparty (listing owner) decides to accept, that
// finalize task is created under THEIR org, invisible to the demo login's own thread. This route
// looks across both sides of the one negotiation this offer_id represents so
// DemoAgentActivityFeed can react to whichever side actually produces the finalize card.
export async function GET(req: NextRequest) {
  const disabled = assertDemoRoutesEnabled()
  if (disabled) return disabled

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient.from('users').select('id, email, org_id').eq('id', user.id).single()
  if (!me || !isDemoAccount(me.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rootTaskId = req.nextUrl.searchParams.get('rootTaskId')
  if (!rootTaskId) return NextResponse.json({ error: 'rootTaskId required' }, { status: 400 })

  const { data: negotiation } = await adminClient
    .from('agent_negotiations')
    .select('id, status, current_round, offer_id, deal_id')
    .eq('agent_task_id', rootTaskId)
    .maybeSingle()

  // Our own side's latest task in the thread (root + any follow-ups)
  const { data: ourTasks } = await adminClient
    .from('agent_tasks')
    .select('*')
    .or(`id.eq.${rootTaskId},root_task_id.eq.${rootTaskId}`)
    .order('created_at', { ascending: false })
    .limit(1)
  const ourCurrentTask = ourTasks?.[0] ?? null

  let counterpartyTask = null
  if (negotiation?.offer_id) {
    const { data } = await adminClient
      .from('agent_tasks')
      .select('*')
      .eq('status', 'awaiting_approval')
      .in('type', ['negotiation_ready_to_finalize', 'negotiation_escalation'])
      .neq('org_id', me.org_id)
      .contains('plan', { offer_id: negotiation.offer_id })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    counterpartyTask = data ?? null
  }

  // Real inputs behind the agent's plan card (components/demo/DemoPlanCard.tsx):
  // the listing it chose, what it bid against the asking price, and who it's
  // dealing with. All read from live rows — the card scores these, it does not
  // invent them.
  let planFacts: Record<string, unknown> | null = null
  const toolInput = (ourCurrentTask?.proposed_action?.tool_input ?? null) as Record<string, unknown> | null
  const listingId = toolInput?.listing_id as string | undefined
  if (listingId) {
    const { data: listing } = await adminClient
      .from('marketplace_listings')
      .select('id, title, target_price, currency, org_id')
      .eq('id', listingId)
      .maybeSingle()
    if (listing) {
      const { data: counterparty } = await adminClient
        .from('organizations')
        .select('legal_name, doing_business_as, passport_score, years_in_operation, kyb_status')
        .eq('id', listing.org_id)
        .maybeSingle()
      planFacts = {
        listing_title: listing.title,
        target_price: listing.target_price == null ? null : Number(listing.target_price),
        currency: listing.currency ?? 'USD',
        offered_price: toolInput?.offered_price == null ? null : Number(toolInput.offered_price),
        offered_quantity: toolInput?.offered_quantity ?? null,
        counterparty_name: counterparty?.doing_business_as ?? counterparty?.legal_name ?? null,
        counterparty_passport_score: counterparty?.passport_score ?? null,
        counterparty_years: counterparty?.years_in_operation ?? null,
        counterparty_kyb: counterparty?.kyb_status ?? null,
        max_rounds: (ourCurrentTask?.plan as Record<string, unknown> | null)?.max_rounds ?? null,
        guardrails_configured: (ourCurrentTask?.plan as Record<string, unknown> | null)?.guardrails_configured ?? null,
      }
    }
  }

  return NextResponse.json({ negotiation, ourCurrentTask, counterpartyTask, planFacts })
}
