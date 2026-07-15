import { acceptOffer, InvalidStateError } from '@/lib/marketplace/offer-actions'

export interface AcceptMarketplaceOfferInput {
  offer_id: string
  acting_org_id: string
}

// This handler is only ever reachable through GATE 2 of the negotiation flow
// (a human approving a 'negotiation_ready_to_finalize' agent_tasks row) — the
// autonomous tick loop must never call this directly. See lib/ai/agent-tick.ts.
export async function acceptMarketplaceOffer(input: AcceptMarketplaceOfferInput) {
  try {
    const { deal, roomId } = await acceptOffer({ offerId: input.offer_id, actingOrgId: input.acting_org_id })
    return {
      offer_id: input.offer_id,
      deal_id: deal.id,
      status: 'accepted',
      room_id: roomId,
      url: `/deals/${deal.id as string}`,
      message: `Deal created from offer ${input.offer_id}.`,
    }
  } catch (err) {
    if (err instanceof InvalidStateError) return { error: err.message }
    return { error: err instanceof Error ? err.message : 'Failed to accept offer' }
  }
}
