import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { assertDemoRoutesEnabled, isDemoAccount } from '@/lib/demo'
import { DEMO_ORG_ID, DEMO_ALL_ORG_IDS } from '@/lib/demo-entities'
import { counterOffer, acceptOffer } from '@/lib/marketplace/offer-actions'
import { postSystemMessage } from '@/lib/ai/agent-task-chat'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/demo/mock-negotiate — demo-only, deterministic replacement for
// waiting on the real pg_cron-speed negotiation tick loop during Scene 7.
//
// The live tick loop (runAgentTick/runListingDefenseTick via /api/demo/tick)
// is genuinely real end to end, which was the whole point of this scene —
// but "genuinely real" also means genuinely UNCERTAIN: each round needs a
// real Claude decision call, convergence isn't guaranteed within any fixed
// time budget, and a live sales demo has zero tolerance for "the offer is
// taking longer than usual this run" appearing in front of a prospect. This
// route keeps the OUTCOME real (real marketplace_offers rounds, a real
// room transcript, a real deals row via the exact same counterOffer/
// acceptOffer functions the human UI and the live tick loop both call — see
// lib/marketplace/offer-actions.ts's own doc comment: "the single
// implementation... both call these functions so the logic only exists
// once") while making the ROUND CONTENT deterministic instead of
// Claude-decided, so it always completes in well under a second with zero
// chance of the timeout/escalation-loop paths the live version could hit.
// counterOffer() still makes one small, non-fatal internal analysis call
// per round (see its own doc comment) — a few hundred tokens total across
// two rounds, nowhere near what a multi-round live negotiation could spend,
// but not literally zero either.
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

  const { data: negotiation } = await adminClient
    .from('agent_negotiations')
    .select('id, agent_task_id, offer_id, org_id')
    .eq('org_id', DEMO_ORG_ID)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!negotiation?.offer_id) {
    return NextResponse.json({ error: 'No active demo negotiation found' }, { status: 404 })
  }

  // Atomically claim this negotiation before doing anything, the same
  // "claim the row first" pattern the real tick loop uses (see
  // lib/ai/agent-tick.ts's own doc comment) — reusing `last_tick_at` since
  // this route only ever needs a one-time claim, not the real loop's
  // repeated-tick expiry window. Concretely observed without this: a
  // duplicate/overlapping call (an interrupted prior run's request still
  // finishing server-side after the client navigated away, in the case
  // that was actually caught) raced this one, and the loser's FIRST
  // counterOffer call threw TurnOrderError because the winner had already
  // advanced the offer past round 1 — a real 500, surfaced to the demo
  // only as a silently-skipped negotiation, not a crash, but still worth
  // preventing outright rather than relying on the caller's fallback.
  const { data: claimed } = await adminClient
    .from('agent_negotiations')
    .update({ last_tick_at: new Date().toISOString() })
    .eq('id', negotiation.id)
    .eq('status', 'active')
    .is('last_tick_at', null)
    .select('id')
    .maybeSingle()

  if (!claimed) {
    return NextResponse.json({ error: 'Negotiation already claimed by another request' }, { status: 409 })
  }

  // Silence every demo org's autonomous agent for the duration of this
  // deterministic run. Concretely observed without this: the real, live
  // pg_cron tick (every 60s against this same tenant, since org_agents.
  // is_active is deliberately kept true for the demo — see /api/demo/reset)
  // fired mid-negotiation and had Ironbridge's own agent genuinely counter
  // the just-submitted offer for real, via runListingDefenseTick — which
  // reacts directly off marketplace_offers turn state, not agent_negotiations,
  // so the claim above doesn't cover it. That real counter landed as round 2
  // a couple seconds before this route's own first counterOffer call, which
  // then hit TurnOrderError trying to make the same move a second time,
  // leaving the offer stuck at round 2 with no deal. Reactivated in the
  // `finally` below unconditionally, so a demo org is never left inert if
  // this route throws.
  await adminClient.from('org_agents').update({ is_active: false }).in('org_id', DEMO_ALL_ORG_IDS)

  const offerId = negotiation.offer_id as string
  const { data: offer } = await adminClient
    .from('marketplace_offers')
    .select('offered_price, from_org_id, listing_id, marketplace_listings(org_id)')
    .eq('id', offerId)
    .single()

  if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })

  const offerorOrgId = offer.from_org_id as string
  // Supabase's JS client returns an embedded to-one relation as a 1-element
  // array when it can't statically infer cardinality from the FK alone.
  const listingRel = offer.marketplace_listings as { org_id: string } | { org_id: string }[] | null
  const listingOrgId = Array.isArray(listingRel) ? listingRel[0]?.org_id : listingRel?.org_id
  if (!listingOrgId) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })

  const opening = Number(offer.offered_price) || 0
  // A believable two-round shape: the counterparty pushes back a bit above
  // our opening offer, then we hold close to it — still a real concession,
  // not zero movement — and they accept rather than drag it out further.
  const round100 = (n: number) => Math.round(n / 100) * 100
  const theirCounter = round100(opening * 1.055)
  const ourCounter = round100(opening * 1.018)

  try {
    await counterOffer({
      offerId, actingOrgId: listingOrgId,
      terms: { offered_price: theirCounter },
      maxRounds: 10,
    })
    await counterOffer({
      offerId, actingOrgId: offerorOrgId,
      terms: { offered_price: ourCounter },
      maxRounds: 10,
    })
    const { deal, roomId } = await acceptOffer({ offerId, actingOrgId: listingOrgId })

    // Pull back the exact content the two counter rounds (+ acceptOffer's own
    // "Deal agreed" line) just posted into the room, so the frontend can play
    // back the real thing rather than reconstructing it — same rich
    // [[STRIKE_BLOCK:comparison]] card a live round would have produced.
    const { data: roundMessages } = roomId
      ? await adminClient
          .from('room_messages')
          .select('content, created_at')
          .eq('room_id', roomId)
          .order('created_at', { ascending: true })
          .limit(20)
      : { data: [] }
    const rounds = (roundMessages ?? [])
      .slice(-3)
      .map(m => ({ content: m.content as string }))

    const outcomeSummary = `Terms landed at ${ourCounter.toLocaleString()} — deal agreed.`
    const rootTaskId = negotiation.agent_task_id as string
    for (const r of rounds) await postSystemMessage(rootTaskId, r.content)
    await postSystemMessage(rootTaskId, outcomeSummary)

    await adminClient.from('agent_negotiations').update({
      status: 'completed_accepted',
      current_round: 3,
      deal_id: (deal as { id: string }).id,
      outcome_summary: outcomeSummary,
      updated_at: new Date().toISOString(),
    }).eq('id', negotiation.id)

    await adminClient.from('agent_tasks').update({
      status: 'completed',
      result: { deal_id: (deal as { id: string }).id, negotiation_outcome: outcomeSummary },
      updated_at: new Date().toISOString(),
    }).eq('id', rootTaskId).eq('status', 'executing')

    return NextResponse.json({ rounds, dealId: (deal as { id: string }).id })
  } catch (err) {
    console.error('[demo/mock-negotiate] failed:', err)
    return NextResponse.json({ error: 'Negotiation failed' }, { status: 500 })
  } finally {
    await adminClient.from('org_agents').update({ is_active: true }).in('org_id', DEMO_ALL_ORG_IDS)
  }
}
