// The autonomous negotiation execution engine — called every 5 minutes by
// Vercel cron (app/api/agents/tick/route.ts). For every active agent_negotiations
// row it decides whether a round has changed, and if so asks Claude to counter,
// reject, or recommend finalization. It NEVER calls accept_marketplace_offer —
// that only ever happens through a human approving a 'negotiation_ready_to_finalize'
// agent_tasks row (GATE 2, see app/api/agents/tasks/[id]/approve/route.ts).
import { createClient as createAdmin } from '@supabase/supabase-js'
import { executeTool } from './tools/execute'
import { NEGOTIATION_TOOLS } from './tools/definitions'
import { HARD_MAX_ROUNDS, HARD_MAX_DEADLINE_DAYS } from './negotiation-constants'
import { postSystemMessage } from './agent-task-chat'
import { getAgentPreferences } from './agent-preferences'
import { isShippingCostRequired } from '@/lib/deals/fees'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const MODEL = 'claude-sonnet-4-6'

interface Plan {
  price_floor?: number | null
  price_ceiling?: number | null
  max_rounds?: number
  deadline_at?: string
  guardrails_configured?: boolean
  negotiation_id?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

export interface TickResult {
  negotiation_id: string
  outcome: string
}

export async function runAgentTick(orgId?: string): Promise<{ processed: number; results: TickResult[] }> {
  let query = adminClient.from('agent_negotiations').select('*').eq('status', 'active')
  if (orgId) query = query.eq('org_id', orgId)
  const { data: negotiations } = await query

  const results: TickResult[] = []
  for (const neg of negotiations ?? []) {
    try {
      const outcome = await tickOne(neg as Row)
      results.push({ negotiation_id: neg.id, outcome })
    } catch (err) {
      results.push({ negotiation_id: neg.id, outcome: `error: ${err instanceof Error ? err.message : 'unknown'}` })
    }
  }
  return { processed: results.length, results }
}

// ── Listing defense: the OTHER half of "autonomous negotiation" ────────────
// runAgentTick above only ever drives negotiations for the org that got a
// plan through GATE 1 (agent_tasks -> agent_negotiations). It does nothing
// for the LISTING OWNER's side — agent_negotiations.offer_id is unique, so
// the counterparty can never get their own row on the same offer through the
// normal flow. Without this, "agent-to-agent negotiation" only ever actually
// moves on one side; the other party (human or not) has to counter manually.
// This function is the counterparty-side equivalent: for every org with an
// active agent, find offers on THEIR OWN listings where it's their turn, and
// react the same way tickOne does — using their standing agent_preferences
// as guardrails (there's no per-negotiation plan to approve here, since
// responding on a listing you already chose to post is lower-commitment than
// proposing a brand new deal). GATE 2 still applies identically: a good offer
// creates a negotiation_ready_to_finalize agent_tasks row, never an auto-accept.
export async function runListingDefenseTick(orgId?: string): Promise<{ processed: number; results: TickResult[] }> {
  let orgQuery = adminClient.from('org_agents').select('org_id').eq('is_active', true)
  if (orgId) orgQuery = orgQuery.eq('org_id', orgId)
  const { data: activeOrgs } = await orgQuery
  const ownerOrgIds = (activeOrgs ?? []).map((r: Row) => r.org_id as string)
  if (ownerOrgIds.length === 0) return { processed: 0, results: [] }

  const { data: listings } = await adminClient
    .from('marketplace_listings')
    .select('id, org_id, title, listing_type, currency, target_price')
    .in('org_id', ownerOrgIds)
    .eq('status', 'active')
  if (!listings?.length) return { processed: 0, results: [] }

  const listingById = new Map(listings.map((l: Row) => [l.id, l]))
  const { data: offers } = await adminClient
    .from('marketplace_offers')
    .select('*')
    .in('listing_id', listings.map((l: Row) => l.id))
    .in('status', ['pending', 'countered'])

  const results: TickResult[] = []
  for (const offer of offers ?? []) {
    try {
    const listing = listingById.get(offer.listing_id)
    if (!listing) continue
    const listingOrgId = listing.org_id as string

    const rounds: Row[] = Array.isArray(offer.offer_rounds) ? offer.offer_rounds : []
    const lastRound = rounds[rounds.length - 1]
    // No rounds yet, or we made the last move — not our turn.
    if (!lastRound || lastRound.by_org_id === listingOrgId) continue

    // If a real GATE-1 negotiation already owns this offer for us (shouldn't
    // normally happen given the unique constraint, but check defensively),
    // let the main tick loop handle it instead of double-acting.
    const { data: existingNeg } = await adminClient
      .from('agent_negotiations')
      .select('id')
      .eq('offer_id', offer.id)
      .eq('org_id', listingOrgId)
      .eq('status', 'active')
      .maybeSingle()
    if (existingNeg) continue

    // Don't re-escalate every tick while a human decision is already pending
    // for this exact offer.
    const { data: pendingEscalations } = await adminClient
      .from('agent_tasks')
      .select('id, plan')
      .eq('org_id', listingOrgId)
      .eq('status', 'awaiting_approval')
      .in('type', ['negotiation_escalation', 'negotiation_ready_to_finalize'])
    const alreadyEscalated = (pendingEscalations ?? []).some((t: Row) => (t.plan as (Plan & { offer_id?: string }) | null)?.offer_id === offer.id)
    if (alreadyEscalated) { results.push({ negotiation_id: offer.id, outcome: 'awaiting_human_decision' }); continue }

    const prefs = await getAgentPreferences(listingOrgId)
    const plan: Plan & { offer_id: string } = {
      price_ceiling: prefs.max_deal_value_auto,
      guardrails_configured: prefs.hasPriceGuardrails,
      max_rounds: HARD_MAX_ROUNDS,
      deadline_at: new Date(Date.now() + HARD_MAX_DEADLINE_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      offer_id: offer.id,
    }

    const decision = await getNegotiationDecision({ offer, listing, plan, actingOrgId: listingOrgId })
    if (!decision) { results.push({ negotiation_id: offer.id, outcome: 'no_decision' }); continue }

    if (decision.tool === 'recommend_finalization') {
      await adminClient.from('agent_tasks').insert({
        org_id: listingOrgId,
        type: 'negotiation_ready_to_finalize',
        title: `Finalize negotiation on "${listing.title}"`.slice(0, 200),
        body: decision.reasoning || 'The agent recommends accepting the counterparty\'s current terms.',
        proposed_action: { tool_name: 'accept_marketplace_offer', tool_input: { offer_id: offer.id, acting_org_id: listingOrgId } },
        plan,
        status: 'awaiting_approval',
      })
      await notifyOrgAdmins(listingOrgId, `Finalize negotiation on "${listing.title}"`, decision.reasoning || '')
      await logAction(listingOrgId, 'negotiation_ready_to_finalize', offer.id, decision.input, { reasoning: decision.reasoning })
      results.push({ negotiation_id: offer.id, outcome: 'escalated_for_finalization' })
      continue
    }

    if (decision.tool === 'reject_marketplace_offer') {
      const result = await executeTool('reject_marketplace_offer', {
        offer_id: offer.id, acting_org_id: listingOrgId,
        reason: decision.input.reason || decision.reasoning || undefined,
      })
      await logAction(listingOrgId, 'negotiation_rejected', offer.id, decision.input, result)
      results.push({ negotiation_id: offer.id, outcome: result.error ? 'failed' : 'rejected' })
      continue
    }

    if (decision.tool === 'counter_marketplace_offer') {
      const price = Number(decision.input.offered_price)
      const violation = checkPriceGuardrail(price, plan)
      if (violation) {
        await adminClient.from('agent_tasks').insert({
          org_id: listingOrgId,
          type: 'negotiation_escalation',
          title: `Approval needed: counter outside guardrails on "${listing.title}"`.slice(0, 200),
          body: `${decision.reasoning ? decision.reasoning + ' ' : ''}This counter (${price} ${listing.currency}) is ${violation}. Approving will submit exactly this counter; rejecting will stop the negotiation.`,
          proposed_action: { tool_name: 'counter_marketplace_offer', tool_input: { ...decision.input, offer_id: offer.id, acting_org_id: listingOrgId, max_rounds: plan.max_rounds } },
          plan,
          status: 'awaiting_approval',
        })
        await notifyOrgAdmins(listingOrgId, `Approval needed: counter outside guardrails on "${listing.title}"`, decision.reasoning || '')
        await logAction(listingOrgId, 'negotiation_escalated', offer.id, decision.input, { reason: violation })
        results.push({ negotiation_id: offer.id, outcome: 'escalated_guardrail' })
        continue
      }

      const result = await executeTool('counter_marketplace_offer', {
        ...decision.input,
        notes: decision.input.notes || decision.reasoning || undefined,
        // Belt-and-suspenders: the prompt now demands shipping_cost explicitly
        // when required, but if Claude still omits it, fall back to whatever
        // the offer's current value is rather than hard-failing the counter
        // with nobody around to retry it.
        shipping_cost: decision.input.shipping_cost ?? offer.shipping_cost ?? undefined,
        offer_id: offer.id,
        acting_org_id: listingOrgId,
        max_rounds: plan.max_rounds,
      })
      await logAction(listingOrgId, 'negotiation_countered', offer.id, decision.input, result)
      results.push({ negotiation_id: offer.id, outcome: result.error ? 'failed' : 'countered' })
      continue
    }

    results.push({ negotiation_id: offer.id, outcome: 'unrecognized_decision' })
    } catch (err) {
      results.push({ negotiation_id: offer.id, outcome: `error: ${err instanceof Error ? err.message : 'unknown'}` })
    }
  }

  return { processed: results.length, results }
}

async function notifyOrgAdmins(orgId: string, title: string, body: string): Promise<void> {
  const { data: admins } = await adminClient
    .from('users')
    .select('id')
    .eq('org_id', orgId)
    .eq('role', 'org_admin')
    .eq('is_active', true)
  if (admins?.length) {
    await adminClient.from('notifications').insert(
      admins.map((u: { id: string }) => ({
        user_id: u.id,
        event: 'agent_proposal',
        title: title.slice(0, 200),
        body: body.slice(0, 200),
        deep_link: '/ai?tab=agent',
      }))
    )
  }
}

async function tickOne(neg: Row): Promise<string> {
  // Atomic claim — prevents two overlapping cron invocations double-acting on
  // the same negotiation. A row is claimable if it's never been ticked, or its
  // last tick was more than 90s ago. This is the actual round-to-round cadence
  // ceiling for this side of a negotiation — keep it a few multiples above the
  // real tick interval (pg_cron fires every 60s, see CLAUDE.md) so overlapping
  // invocations still can't double-claim, without making a demo wait 4+ minutes
  // between rounds the way the original 4-minute window (sized for a 5-minute
  // GitHub Actions cadence) did.
  const claimBefore = new Date(Date.now() - 90 * 1000).toISOString()
  const { data: claimed } = await adminClient
    .from('agent_negotiations')
    .update({ last_tick_at: new Date().toISOString() })
    .eq('id', neg.id)
    .eq('status', 'active')
    .or(`last_tick_at.is.null,last_tick_at.lt.${claimBefore}`)
    .select()
    .maybeSingle()

  if (!claimed) return 'skipped_claimed_elsewhere'

  const [{ data: task }, { data: orgAgent }] = await Promise.all([
    adminClient.from('agent_tasks').select('plan, org_id').eq('id', claimed.agent_task_id).single(),
    adminClient.from('org_agents').select('is_active').eq('org_id', claimed.org_id).single(),
  ])

  const plan: Plan = (task?.plan ?? {}) as Plan
  const maxRounds = Math.min(plan.max_rounds ?? HARD_MAX_ROUNDS, HARD_MAX_ROUNDS)
  const hardDeadline = new Date(new Date(claimed.created_at as string).getTime() + HARD_MAX_DEADLINE_DAYS * 24 * 60 * 60 * 1000)
  const planDeadline = plan.deadline_at ? new Date(plan.deadline_at) : null
  const effectiveDeadline = planDeadline && planDeadline.getTime() < hardDeadline.getTime() ? planDeadline : hardDeadline

  if (!orgAgent?.is_active) return await halt(claimed, 'halted_guardrail', 'The org\'s agent was deactivated.')
  if (claimed.halt_requested) return await halt(claimed, 'halted_by_user', 'Stopped by user request.')
  if (new Date() > effectiveDeadline) return await halt(claimed, 'completed_deadline', 'Negotiation deadline passed with no resolution.')

  // ── Resolve the offer this negotiation is tracking ─────────────────────
  let offerId = claimed.offer_id as string | null
  if (!offerId) {
    if (!claimed.listing_id) return await halt(claimed, 'failed', 'Negotiation has neither a listing nor an offer to track.')
    const { data: incoming } = await adminClient
      .from('marketplace_offers')
      .select('id')
      .eq('listing_id', claimed.listing_id)
      .neq('from_org_id', claimed.org_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!incoming) return 'no_offer_yet'
    offerId = incoming.id
    await adminClient.from('agent_negotiations').update({ offer_id: offerId }).eq('id', claimed.id)
  }

  const { data: offer } = await adminClient
    .from('marketplace_offers')
    .select('*, marketplace_listings(id, org_id, title, listing_type, currency, target_price)')
    .eq('id', offerId)
    .single()
  if (!offer) return await halt(claimed, 'failed', 'The linked offer no longer exists.')

  const listing = offer.marketplace_listings as Row

  if (offer.status === 'rejected') return await finish(claimed, 'completed_rejected', 'The counterparty rejected the offer.')
  if (offer.status === 'accepted') {
    // A human accepted directly via the marketplace UI (either party can do
    // this at any time — that's always allowed; only the AGENT is barred from
    // finalizing on its own). Reconcile rather than re-process.
    return await finish(claimed, 'completed_accepted', 'The offer was accepted.', offer.deal_id as string | undefined)
  }
  if (!['pending', 'countered'].includes(offer.status)) {
    return await halt(claimed, 'failed', `Unexpected offer status: ${offer.status}`)
  }

  const rounds: Row[] = Array.isArray(offer.offer_rounds) ? offer.offer_rounds : []
  const lastRound = rounds[rounds.length - 1]

  if (!lastRound || lastRound.by_org_id === claimed.org_id) {
    // We made the last move — waiting on the counterparty. Nothing changed.
    await adminClient.from('agent_negotiations').update({
      last_seen_offer_round: offer.current_round ?? 1,
    }).eq('id', claimed.id)
    return 'waiting_on_counterparty'
  }

  // Don't re-escalate every tick while a human decision is already pending.
  const { data: pendingEscalations } = await adminClient
    .from('agent_tasks')
    .select('id, plan')
    .eq('org_id', claimed.org_id)
    .eq('status', 'awaiting_approval')
    .in('type', ['negotiation_escalation', 'negotiation_ready_to_finalize'])
  const alreadyEscalated = (pendingEscalations ?? []).some((t) => (t.plan as Plan | null)?.negotiation_id === claimed.id)
  if (alreadyEscalated) return 'awaiting_human_decision'

  const decision = await getNegotiationDecision({ offer, listing, plan, actingOrgId: claimed.org_id })
  if (!decision) return 'no_decision'

  if (decision.tool === 'recommend_finalization') {
    await createFollowUpTask(claimed, 'negotiation_ready_to_finalize', {
      title: `Finalize negotiation on "${listing.title}"`,
      body: decision.reasoning || 'The agent recommends accepting the counterparty\'s current terms.',
      tool_name: 'accept_marketplace_offer',
      tool_input: { offer_id: offerId, acting_org_id: claimed.org_id },
    }, plan)
    await logAction(claimed.org_id, 'negotiation_ready_to_finalize', offerId, decision.input, { reasoning: decision.reasoning })
    return 'escalated_for_finalization'
  }

  if (decision.tool === 'reject_marketplace_offer') {
    const result = await executeTool('reject_marketplace_offer', {
      offer_id: offerId,
      acting_org_id: claimed.org_id,
      reason: decision.input.reason || decision.reasoning || undefined,
    })
    await logAction(claimed.org_id, 'negotiation_rejected', offerId, decision.input, result)
    if (result.error) return await halt(claimed, 'failed', `Autonomous reject failed: ${result.error}`)
    return await finish(claimed, 'completed_rejected', decision.reasoning || 'Agent rejected the offer autonomously.')
  }

  if (decision.tool === 'counter_marketplace_offer') {
    const price = Number(decision.input.offered_price)
    const violation = checkPriceGuardrail(price, plan)

    if (violation) {
      await createFollowUpTask(claimed, 'negotiation_escalation', {
        title: `Approval needed: counter outside guardrails on "${listing.title}"`,
        body: `${decision.reasoning ? decision.reasoning + ' ' : ''}This counter (${price} ${listing.currency}) is ${violation}. Approving will submit exactly this counter; rejecting will stop the negotiation.`,
        tool_name: 'counter_marketplace_offer',
        tool_input: { ...decision.input, offer_id: offerId, acting_org_id: claimed.org_id, max_rounds: maxRounds },
      }, plan)
      await logAction(claimed.org_id, 'negotiation_escalated', offerId, decision.input, { reason: violation })
      return 'escalated_guardrail'
    }

    const result = await executeTool('counter_marketplace_offer', {
      ...decision.input,
      notes: decision.input.notes || decision.reasoning || undefined,
      shipping_cost: decision.input.shipping_cost ?? offer.shipping_cost ?? undefined,
      offer_id: offerId,
      acting_org_id: claimed.org_id,
      max_rounds: maxRounds,
    })
    await logAction(claimed.org_id, 'negotiation_countered', offerId, decision.input, result)
    if (result.error) return await halt(claimed, 'failed', `Autonomous counter failed: ${result.error}`)

    const newRound = (result.current_round as number | undefined) ?? (claimed.current_round ?? 0) + 1
    await adminClient.from('agent_negotiations').update({
      current_round: newRound,
      last_seen_offer_round: newRound,
    }).eq('id', claimed.id)

    // Round N-1 (counterparty) vs round N (us) as a comparison block — reads
    // as an actual negotiation exchange in the task thread, not just a price.
    const fmtPrice = (v: unknown) => v != null ? `${Number(v).toLocaleString()} ${listing.currency}` : '—'
    const comparison = {
      type: 'comparison',
      title: `Round ${newRound}`,
      left: {
        label: `Their offer (Round ${newRound - 1})`,
        items: [
          { label: 'Price', value: fmtPrice(lastRound?.offered_price) },
          { label: 'Incoterms', value: lastRound?.proposed_incoterms || '—' },
          { label: 'Payment Terms', value: lastRound?.proposed_payment_terms || '—' },
        ],
      },
      right: {
        label: 'Our counter',
        items: [
          { label: 'Price', value: fmtPrice(decision.input.offered_price) },
          { label: 'Incoterms', value: decision.input.proposed_incoterms || lastRound?.proposed_incoterms || '—' },
          { label: 'Payment Terms', value: decision.input.proposed_payment_terms || lastRound?.proposed_payment_terms || '—' },
        ],
      },
    }
    await postSystemMessage(
      claimed.agent_task_id,
      `Round ${newRound}: countered at ${price} ${listing.currency}.\n\n[[STRIKE_BLOCK:${JSON.stringify(comparison)}]]\n\n${decision.reasoning}`.trim()
    )
    return 'countered'
  }

  return 'unrecognized_decision'
}

/** null = within bounds (or no guardrails configured); string = human-readable violation. */
function checkPriceGuardrail(price: number, plan: Plan): string | null {
  if (!Number.isFinite(price)) return null
  if (plan.price_ceiling != null && price > plan.price_ceiling) return `above the configured price ceiling of ${plan.price_ceiling}`
  if (plan.price_floor != null && price < plan.price_floor) return `below the configured price floor of ${plan.price_floor}`
  return null
}

async function halt(neg: Row, status: string, summary: string): Promise<string> {
  await adminClient.from('agent_negotiations').update({
    status, outcome_summary: summary, updated_at: new Date().toISOString(),
  }).eq('id', neg.id)
  await closeOriginalTask(neg, summary)
  return status
}

async function finish(neg: Row, status: string, summary: string, dealId?: string): Promise<string> {
  await adminClient.from('agent_negotiations').update({
    status, outcome_summary: summary, deal_id: dealId ?? null, updated_at: new Date().toISOString(),
  }).eq('id', neg.id)
  await closeOriginalTask(neg, summary)
  return status
}

// The agent_tasks row that started this negotiation was left at status
// 'executing' when GATE 1 was approved; close it out once the negotiation
// itself reaches a terminal state so the UI stops showing it as in-flight.
async function closeOriginalTask(neg: Row, summary: string): Promise<void> {
  await adminClient.from('agent_tasks').update({
    status: 'completed',
    result: { negotiation_outcome: summary },
    updated_at: new Date().toISOString(),
  }).eq('id', neg.agent_task_id).eq('status', 'executing')
  await postSystemMessage(neg.agent_task_id, summary)
}

async function createFollowUpTask(
  neg: Row,
  type: 'negotiation_escalation' | 'negotiation_ready_to_finalize',
  action: { title: string; body: string; tool_name: string; tool_input: Record<string, unknown> },
  plan: Plan
): Promise<void> {
  await adminClient.from('agent_tasks').insert({
    org_id: neg.org_id,
    type,
    title: action.title.slice(0, 200),
    body: action.body,
    proposed_action: { tool_name: action.tool_name, tool_input: action.tool_input },
    plan: { ...plan, negotiation_id: neg.id },
    status: 'awaiting_approval',
    root_task_id: neg.agent_task_id,
  })

  await postSystemMessage(neg.agent_task_id, action.body)

  const { data: admins } = await adminClient
    .from('users')
    .select('id')
    .eq('org_id', neg.org_id)
    .eq('role', 'org_admin')
    .eq('is_active', true)

  if (admins?.length) {
    await adminClient.from('notifications').insert(
      admins.map((u: { id: string }) => ({
        user_id: u.id,
        event: 'agent_proposal',
        title: action.title,
        body: action.body.slice(0, 200),
        deep_link: '/ai?tab=agent',
      }))
    )
  }
}

async function logAction(
  orgId: string,
  actionType: string,
  offerId: string | null,
  input: Record<string, unknown>,
  output: Record<string, unknown>
): Promise<void> {
  const { error } = await adminClient.from('agent_actions').insert({
    org_id: orgId,
    action_type: actionType,
    entity_type: 'marketplace_offer',
    entity_id: offerId,
    input_summary: JSON.stringify(input).slice(0, 500),
    output_summary: JSON.stringify(output).slice(0, 500),
    outcome: 'error' in output ? 'error' : 'success',
    requires_approval: false,
    human_approved: false,
    model: MODEL,
    reasoning: 'Autonomous negotiation tick',
  })
  if (error) console.error('[agent-tick] agent_actions log failed:', error)
}

interface Decision {
  tool: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: any
  reasoning: string
}

async function getNegotiationDecision(args: { offer: Row; listing: Row; plan: Plan; actingOrgId: string }): Promise<Decision | null> {
  const { offer, listing, plan, actingOrgId } = args
  const rounds: Row[] = Array.isArray(offer.offer_rounds) ? offer.offer_rounds : []
  const lastRound = rounds[rounds.length - 1]

  // Whoever plays supplier bears main carriage under CFR/CIF/CPT/CIP/DAP/DPU/DDP
  // and MUST supply shipping_cost on counter_marketplace_offer — offer-actions.ts
  // hard-rejects the whole counter otherwise, which is fatal in an unattended
  // loop (no human around to retry). Claude reliably omits this unless told
  // explicitly, so state it as a hard requirement, not a schema hint.
  const isListingOwner = actingOrgId === listing.org_id
  const actingIsSupplier = isListingOwner
    ? listing.listing_type === 'product_service'
    : listing.listing_type === 'po_request'
  const effectiveIncoterms = lastRound?.proposed_incoterms as string | undefined
  const shippingCostWillBeRequired = actingIsSupplier && isShippingCostRequired(effectiveIncoterms)

  // Pull the recent conversation in the shared deal room (if one exists yet)
  // so the agent can react to anything the counterparty's agent — or a human
  // — actually said, not just the raw price/terms.
  let roomConversation = 'No room conversation yet.'
  if (offer.room_id) {
    const { data: recentMessages } = await adminClient
      .from('room_messages')
      .select('content, message_type, org_id, created_at')
      .eq('room_id', offer.room_id)
      .eq('status', 'visible')
      .order('created_at', { ascending: false })
      .limit(8)
    if (recentMessages?.length) {
      const orgIds = [...new Set(recentMessages.map((m) => m.org_id).filter(Boolean))]
      const { data: orgs } = orgIds.length
        ? await adminClient.from('organizations').select('id, legal_name').in('id', orgIds)
        : { data: [] as Row[] }
      const orgNameById = new Map((orgs ?? []).map((o) => [o.id, o.legal_name]))
      roomConversation = [...recentMessages].reverse()
        .map((m) => `[${orgNameById.get(m.org_id) ?? 'Unknown'}] ${m.content}`)
        .join('\n')
    }
  }

  const system = `You are Strike AI, autonomously negotiating a marketplace deal on behalf of an organization on the Strike SCF platform.

Listing: "${listing.title}" (listing_id: ${listing.id}, ${listing.listing_type}), currency ${listing.currency}, target price ${listing.target_price ?? 'not specified'}.
Offer (offer_id: ${offer.id}) status: ${offer.status}, round ${offer.current_round ?? 1}.
Counterparty's latest terms — price: ${lastRound?.offered_price}, quantity: ${lastRound?.offered_quantity ?? 'n/a'}, delivery: ${lastRound?.proposed_delivery_date ?? 'n/a'}, incoterms: ${lastRound?.proposed_incoterms ?? 'n/a'}, payment terms: ${lastRound?.proposed_payment_terms ?? 'n/a'}, notes: ${lastRound?.notes ?? 'none'}.

Recent conversation in the shared deal room (most recent last — this may include the counterparty's own agent explaining ITS reasoning, or a human chiming in; weigh it, but the structured terms above are the source of truth for what's actually being offered):
${roomConversation}

Hard limits you must respect:
${plan.guardrails_configured
    ? `- Price floor: ${plan.price_floor ?? 'none'}\n- Price ceiling: ${plan.price_ceiling ?? 'none'}`
    : '- No price guardrails are configured for this org — use your own commercial judgment, staying reasonable relative to the listing\'s target price.'}
- Max negotiation rounds: ${plan.max_rounds}
- Deadline: ${plan.deadline_at}

You are the ${actingIsSupplier ? 'SUPPLIER' : 'BUYER'} in this deal.
${shippingCostWillBeRequired ? `You MUST include a "shipping_cost" number in your counter_marketplace_offer call. Incoterm ${effectiveIncoterms} puts main carriage on the supplier (you) — omitting shipping_cost will make the counter fail outright, with no human able to retry it. Estimate a realistic freight cost from the goods, quantity, and route if one isn't already specified in the listing or prior rounds; do not leave it blank.` : ''}

You must call exactly one tool to make your decision:
- counter_marketplace_offer — propose improved terms back to the counterparty. Always fill in "notes" with 1-2 sentences of real reasoning — this is posted into the shared deal room so the counterparty (their agent or a human) can see WHY you countered, not just the number.
- reject_marketplace_offer — decline outright if the terms are clearly unacceptable (this commits to nothing, so use it freely when a counter isn't worth making). Always fill in "reason".
- recommend_finalization — if the counterparty's CURRENT terms are good and should be accepted. You cannot accept an offer yourself; this flags it for a human to make the final call.
- get_pricing_insights / evaluate_listing_offers — only if you need more market data before deciding; you'll be asked to decide again right after.

Make one decision now. If you call counter_marketplace_offer or reject_marketplace_offer or recommend_finalization, briefly state your reasoning in a short text block before the tool call as well.`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [{ role: 'user', content: 'Decide how to respond to the counterparty\'s latest offer.' }]

  for (let i = 0; i < 3; i++) {
    let res: Response
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1024,
          system,
          messages,
          tools: NEGOTIATION_TOOLS,
          // disable_parallel_tool_use is required here — with plain {type:'any'},
          // Claude sometimes returns two tool_use blocks in one turn (e.g. both
          // get_pricing_insights and evaluate_listing_offers), but this loop only
          // ever sends a tool_result for the first one, which leaves the second
          // unanswered and makes the NEXT API call malformed (Anthropic requires
          // every tool_use to get a matching tool_result before the next turn).
          tool_choice: { type: 'any', disable_parallel_tool_use: true },
        }),
      })
    } catch {
      return null
    }
    if (!res.ok) return null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json()
    const content = data.content ?? []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolUse = content.find((b: any) => b.type === 'tool_use')
    if (!toolUse) return null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const textBlock = content.find((b: any) => b.type === 'text')
    const reasoning = (textBlock?.text as string | undefined)?.trim() || (toolUse.input?.reasoning as string | undefined) || ''

    if (toolUse.name === 'get_pricing_insights' || toolUse.name === 'evaluate_listing_offers') {
      const result = await executeTool(toolUse.name, toolUse.input)
      messages.push({ role: 'assistant', content })
      messages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) }],
      })
      continue
    }

    return { tool: toolUse.name as string, input: toolUse.input, reasoning }
  }

  return null
}
