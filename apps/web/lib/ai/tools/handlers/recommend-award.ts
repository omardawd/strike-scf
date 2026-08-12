import { adminClient } from '../admin'
import { isOrgAdmitted } from '@/lib/auth/admission'
import { writeAuditEvent } from '@/lib/audit/log'

export type ToolActor = { userId: string; orgId: string | null; bankId: string | null }

export interface RecommendAwardInput {
  listing_id: string
  offer_id: string
  rationale: string
  risks?: string
  comparison?: Record<string, unknown>
}

const ACTIONABLE_OFFER_STATUSES = ['pending', 'countered']

/**
 * Creates a NON-BINDING award_recommendation agent_tasks row. This function
 * NEVER calls acceptOffer()/counterOffer() itself — the only way the
 * recommended offer is ever actually accepted is a human explicitly
 * approving this task via the EXISTING /api/agents/tasks/[id]/approve route,
 * which executes proposed_action.tool_name ('accept_marketplace_offer')
 * through the same GATE-2 path already used for negotiation finalization.
 * acceptOffer() (lib/marketplace/offer-actions.ts) independently re-validates
 * offer state and BOTH parties' admission at approval time — this handler's
 * job is only to refuse creating a recommendation that's already invalid.
 *
 * Every id here (listing_id, offer_id, actor.orgId) is re-derived from the
 * database, never trusted as consistent just because the model supplied it
 * together — offer.listing_id is checked against listing_id explicitly to
 * block a cross-listing offer from ever being recommended.
 */
export async function recommendAward(input: RecommendAwardInput, actor?: ToolActor) {
  if (!actor?.orgId) return { error: 'An authenticated organization user is required' }

  const { data: listing } = await adminClient
    .from('marketplace_listings')
    .select('id, org_id, listing_type, title')
    .eq('id', input.listing_id)
    .single()
  if (!listing) return { error: 'Listing not found' }
  if (listing.org_id !== actor.orgId) return { error: 'Forbidden — only the listing owner can recommend an award' }
  if (listing.listing_type !== 'po_request') {
    return { error: 'Award recommendations are only available for po_request (sourcing) listings' }
  }

  const { data: offer } = await adminClient
    .from('marketplace_offers')
    .select('id, listing_id, from_org_id, status, offered_price, current_round')
    .eq('id', input.offer_id)
    .single()
  if (!offer) return { error: 'Offer not found' }
  if (offer.listing_id !== input.listing_id) {
    return { error: 'This offer does not belong to the specified listing' }
  }
  if (!ACTIONABLE_OFFER_STATUSES.includes(offer.status)) {
    return { error: `Offer is not currently actionable (status: ${offer.status})` }
  }

  const { data: offerorOrg } = await adminClient
    .from('organizations')
    .select('status, kyb_status')
    .eq('id', offer.from_org_id)
    .single()
  if (!isOrgAdmitted(offerorOrg)) {
    return { error: 'The proposed supplier is not currently admitted (approved + active)' }
  }

  const { data: task, error } = await adminClient
    .from('agent_tasks')
    .insert({
      org_id: actor.orgId,
      type: 'award_recommendation',
      title: `Award recommendation — ${listing.title}`,
      body: input.rationale,
      proposed_action: {
        tool_name: 'accept_marketplace_offer',
        tool_input: { offer_id: offer.id, acting_org_id: actor.orgId },
      },
      // snapshot_round is the staleness guard: lib/ai/agent-approve.ts refuses
      // to execute this task if the offer's current_round has moved since
      // this snapshot (i.e. the offer changed after the recommendation).
      plan: {
        listing_id: input.listing_id,
        proposed_offer_id: offer.id,
        snapshot_round: offer.current_round,
        comparison: input.comparison ?? null,
        risks: input.risks ?? null,
      },
      status: 'awaiting_approval',
    })
    .select()
    .single()
  if (error || !task) return { error: 'Failed to create award recommendation' }

  void writeAuditEvent({
    actorUserId: actor.userId,
    tenantOrgId: actor.orgId,
    action: 'sourcing.award_recommended',
    targetType: 'agent_task',
    targetId: task.id,
    source: 'ai_tool',
    afterData: { listing_id: input.listing_id, offer_id: offer.id },
  })

  return {
    task_id: task.id,
    message: 'Award recommendation posted to the Agent tab. The buyer must explicitly approve it before the offer is accepted and a deal is created.',
    url: `/marketplace/listings/${input.listing_id}`,
  }
}
