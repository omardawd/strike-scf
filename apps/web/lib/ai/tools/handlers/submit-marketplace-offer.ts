import { adminClient } from '../admin'

export interface SubmitMarketplaceOfferInput {
  listing_id: string
  from_org_id: string
  offered_price?: number
  offered_quantity?: number
  proposed_delivery_date?: string
  proposed_incoterms?: string
  proposed_payment_terms?: string
  notes?: string
}

export async function submitMarketplaceOffer(input: SubmitMarketplaceOfferInput) {
  // Verify the listing exists and is active
  const { data: listing, error: listingErr } = await adminClient
    .from('marketplace_listings')
    .select('id, title, status, org_id, listing_type, currency, target_price, delivery_deadline')
    .eq('id', input.listing_id)
    .single()

  if (listingErr || !listing) {
    return { error: 'Listing not found or no longer available.' }
  }

  if (listing.status !== 'active') {
    return { error: `Listing is not active (status: ${listing.status}). Cannot submit an offer.` }
  }

  if (listing.org_id === input.from_org_id) {
    return { error: 'You cannot submit an offer on your own listing.' }
  }

  // offer_rounds must carry the first round — the counter-offer turn-order
  // logic in app/api/marketplace/offers/[id]/route.ts reads the LAST round's
  // by_org_id to decide whose turn it is next; an empty array reads as "no
  // rounds yet" and always defaults to the listing owner's turn, which is
  // wrong once this org has actually made an offer.
  const now = new Date().toISOString()
  const firstRound = {
    round: 1,
    offered_price: input.offered_price ?? null,
    offered_quantity: input.offered_quantity ?? null,
    proposed_delivery_date: input.proposed_delivery_date ?? null,
    proposed_incoterms: input.proposed_incoterms ?? null,
    proposed_payment_terms: input.proposed_payment_terms ?? null,
    shipping_cost: null,
    notes: input.notes ?? null,
    offer_items: null,
    by_org_id: input.from_org_id,
    at: now,
  }

  const { data: offer, error: offerErr } = await adminClient
    .from('marketplace_offers')
    .insert({
      listing_id: input.listing_id,
      from_org_id: input.from_org_id,
      offered_price: input.offered_price ?? null,
      offered_quantity: input.offered_quantity ?? null,
      proposed_delivery_date: input.proposed_delivery_date ?? null,
      proposed_incoterms: input.proposed_incoterms ?? null,
      proposed_payment_terms: input.proposed_payment_terms ?? null,
      notes: input.notes ?? null,
      status: 'pending',
      current_round: 1,
      offer_rounds: [firstRound],
    })
    .select('id, status, created_at')
    .single()

  if (offerErr || !offer) {
    return { error: `Failed to submit offer: ${offerErr?.message}` }
  }

  return {
    offer_id: offer.id,
    listing_id: input.listing_id,
    listing_title: listing.title,
    status: offer.status,
    offered_price: input.offered_price,
    offered_quantity: input.offered_quantity,
    proposed_delivery_date: input.proposed_delivery_date,
    proposed_incoterms: input.proposed_incoterms,
    proposed_payment_terms: input.proposed_payment_terms,
    created_at: offer.created_at,
    url: `/marketplace/listings/${input.listing_id}`,
  }
}
