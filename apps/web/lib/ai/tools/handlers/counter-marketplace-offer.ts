import { counterOffer, TurnOrderError, InvalidStateError, GuardrailError, type CounterTerms } from '@/lib/marketplace/offer-actions'

export interface CounterMarketplaceOfferInput extends CounterTerms {
  offer_id: string
  acting_org_id: string
  max_rounds?: number
}

export async function counterMarketplaceOffer(input: CounterMarketplaceOfferInput) {
  try {
    const { offer, roomId } = await counterOffer({
      offerId: input.offer_id,
      actingOrgId: input.acting_org_id,
      terms: {
        offered_price: input.offered_price,
        offered_quantity: input.offered_quantity,
        proposed_delivery_date: input.proposed_delivery_date,
        proposed_incoterms: input.proposed_incoterms,
        proposed_payment_terms: input.proposed_payment_terms,
        shipping_cost: input.shipping_cost,
        notes: input.notes,
        offer_items: input.offer_items,
      },
      maxRounds: input.max_rounds,
    })
    return {
      offer_id: input.offer_id,
      status: offer.status,
      current_round: offer.current_round,
      room_id: roomId,
      url: roomId ? `/rooms/${roomId}` : `/marketplace/listings/${offer.listing_id as string}`,
    }
  } catch (err) {
    if (err instanceof TurnOrderError) return { error: `Not this org's turn to counter: ${err.message}` }
    if (err instanceof GuardrailError) return { error: `Guardrail violation: ${err.message}` }
    if (err instanceof InvalidStateError) return { error: err.message }
    return { error: err instanceof Error ? err.message : 'Failed to submit counter-offer' }
  }
}
