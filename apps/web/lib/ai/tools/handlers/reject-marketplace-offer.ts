import { rejectOffer, InvalidStateError } from '@/lib/marketplace/offer-actions'

export interface RejectMarketplaceOfferInput {
  offer_id: string
  acting_org_id: string
  reason?: string
}

export async function rejectMarketplaceOffer(input: RejectMarketplaceOfferInput) {
  try {
    const { offer } = await rejectOffer({
      offerId: input.offer_id,
      actingOrgId: input.acting_org_id,
      reasoning: input.reason,
    })
    return {
      offer_id: input.offer_id,
      status: offer.status,
      reason: input.reason ?? null,
    }
  } catch (err) {
    if (err instanceof InvalidStateError) return { error: err.message }
    return { error: err instanceof Error ? err.message : 'Failed to reject offer' }
  }
}
