import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { DEMO_EMAIL, isDemoAccount } from '@/lib/demo'
import {
  DEMO_ALL_ORG_IDS,
  DEMO_LISTING_IDS,
  DEMO_SEEDED_DEAL_IDS,
  DEMO_SEEDED_AGENT_TASK_IDS,
  DEMO_SEEDED_ROOM_IDS,
} from '@/lib/demo-entities'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/demo/reset — wipes everything the scripted tour or a live "find
// me a deal" run generated on top of the seeded demo tenant (supabase/
// seed-demo.sql), so the next viewing starts clean. Only ever touches rows
// scoped to the demo org + its 3 seeded counterparties — every delete below
// is qualified by DEMO_ALL_ORG_IDS or a subquery derived from it, and the
// static seed rows (orgs, users, listings, the bank/program, the two seeded
// deals, the one seeded agent_tasks proposal) are preserved, not recreated.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, role, email')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const allowed = me.role === 'strike_admin' || isDemoAccount(me.email)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // The demo account's own user id — NOT necessarily `me.id`, since a
  // strike_admin can trigger this reset on the demo account's behalf.
  const { data: demoUser } = await adminClient
    .from('users')
    .select('id')
    .eq('email', DEMO_EMAIL)
    .single()
  if (!demoUser) return NextResponse.json({ error: 'Demo account not found' }, { status: 500 })

  const counts: Record<string, number> = {}

  // 1. Financing requests + their bank offers (nothing here is seeded).
  const { data: finReqs } = await adminClient
    .from('financing_requests')
    .select('id')
    .in('requesting_org_id', DEMO_ALL_ORG_IDS)
  const finReqIds = (finReqs ?? []).map(r => r.id)
  if (finReqIds.length) {
    const { count: offerCount } = await adminClient
      .from('financing_request_offers')
      .delete({ count: 'exact' })
      .in('request_id', finReqIds)
    counts.financing_request_offers = offerCount ?? 0
    const { count: reqCount } = await adminClient
      .from('financing_requests')
      .delete({ count: 'exact' })
      .in('id', finReqIds)
    counts.financing_requests = reqCount ?? 0
  }

  // 2. Rooms created by a demo org during a live negotiation, and their
  //    participants/messages — except the one seeded room (the Ironbridge
  //    negotiation transcript), which is kept exactly as seeded.
  const { data: demoRooms } = await adminClient
    .from('rooms')
    .select('id')
    .in('created_by_org_id', DEMO_ALL_ORG_IDS)
  const roomIds = (demoRooms ?? []).map(r => r.id).filter(id => !DEMO_SEEDED_ROOM_IDS.includes(id))
  if (roomIds.length) {
    const { count: msgCount } = await adminClient.from('room_messages').delete({ count: 'exact' }).in('room_id', roomIds)
    counts.room_messages = msgCount ?? 0
    const { count: partCount } = await adminClient.from('room_participants').delete({ count: 'exact' }).in('room_id', roomIds)
    counts.room_participants = partCount ?? 0
    const { count: roomCount } = await adminClient.from('rooms').delete({ count: 'exact' }).in('id', roomIds)
    counts.rooms = roomCount ?? 0
  }

  // 3. Marketplace offers made on the seeded listings, or by any demo org.
  const { count: offersCount } = await adminClient
    .from('marketplace_offers')
    .delete({ count: 'exact' })
    .or(`listing_id.in.(${DEMO_LISTING_IDS.join(',')}),from_org_id.in.(${DEMO_ALL_ORG_IDS.join(',')})`)
  counts.marketplace_offers = offersCount ?? 0

  // 4. Autonomous negotiation state for a demo org (nothing here is seeded).
  const { count: negCount } = await adminClient
    .from('agent_negotiations')
    .delete({ count: 'exact' })
    .in('org_id', DEMO_ALL_ORG_IDS)
  counts.agent_negotiations = negCount ?? 0

  // 5. Agent task threads — clear every demo org's messages (including the
  //    seeded plan card's own thread, so it goes back to "no messages yet"),
  //    then delete every agent_tasks row except the one seeded plan card.
  const { data: demoTasks } = await adminClient
    .from('agent_tasks')
    .select('id')
    .in('org_id', DEMO_ALL_ORG_IDS)
  const demoTaskIds = (demoTasks ?? []).map(t => t.id)
  if (demoTaskIds.length) {
    const { count: msgCount } = await adminClient
      .from('agent_task_messages')
      .delete({ count: 'exact' })
      .in('agent_task_id', demoTaskIds)
    counts.agent_task_messages = msgCount ?? 0
  }
  const liveTaskIds = demoTaskIds.filter(id => !DEMO_SEEDED_AGENT_TASK_IDS.includes(id))
  if (liveTaskIds.length) {
    const { count: taskCount } = await adminClient.from('agent_tasks').delete({ count: 'exact' }).in('id', liveTaskIds)
    counts.agent_tasks = taskCount ?? 0
  }
  // Reset the seeded plan card back to its original awaiting-approval state
  // in case it was approved/rejected during a prior viewing.
  await adminClient
    .from('agent_tasks')
    .update({ status: 'awaiting_approval', result: null, approved_by_user_id: null, approved_at: null, rejected_reason: null })
    .in('id', DEMO_SEEDED_AGENT_TASK_IDS)

  // 6. Deals + their event logs, except the two seeded deals.
  const { data: demoDeals } = await adminClient
    .from('deals')
    .select('id')
    .or(`buyer_org_id.in.(${DEMO_ALL_ORG_IDS.join(',')}),supplier_org_id.in.(${DEMO_ALL_ORG_IDS.join(',')})`)
  const liveDealIds = (demoDeals ?? []).map(d => d.id).filter(id => !DEMO_SEEDED_DEAL_IDS.includes(id))
  if (liveDealIds.length) {
    const { count: eventCount } = await adminClient.from('deal_events').delete({ count: 'exact' }).in('deal_id', liveDealIds)
    counts.deal_events = eventCount ?? 0
    const { count: dealCount } = await adminClient.from('deals').delete({ count: 'exact' }).in('id', liveDealIds)
    counts.deals = dealCount ?? 0
  }

  // 7. Restore the seeded listings' mutable counters (a live offer/negotiation
  //    can bump view_count/offer_count or flip status away from 'active').
  //    Also bump created_at to "now" — the demo tour's Strike Place beat spotlights
  //    DEMO_IRONBRIDGE_COILS_LISTING_ID by data-demo-target, and the marketplace
  //    grid's default "Most Recent" sort only fetches the top 20 listings; a
  //    seeded created_at that's merely days old silently falls off that page as
  //    other (non-demo) listings accumulate, and the tour's cursor has nothing
  //    real to click on.
  const matchedListingId = DEMO_LISTING_IDS[DEMO_LISTING_IDS.length - 1]
  const openListingIds = DEMO_LISTING_IDS.filter(id => id !== matchedListingId)
  await adminClient
    .from('marketplace_listings')
    .update({ status: 'active', view_count: 0, offer_count: 0, matched_deal_id: null, created_at: new Date().toISOString() })
    .in('id', openListingIds)

  // 8. Let the intro cinematic auto-play again on next login.
  await adminClient
    .from('demo_account_state')
    .upsert(
      { user_id: demoUser.id, intro_played_at: null, last_reset_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )

  return NextResponse.json({ ok: true, deleted: counts })
}
