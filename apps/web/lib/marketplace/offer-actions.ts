// Shared marketplace-offer action library — the single implementation of
// turn-order enforcement, room creation, and deal creation on accept. Both the
// human-facing route (app/api/marketplace/offers/[id]/route.ts) and the AI
// tool handlers (lib/ai/tools/handlers/{counter,accept,reject}-marketplace-offer.ts)
// call these functions so the logic only exists once.
import { createClient as createAdmin } from '@supabase/supabase-js'
import { callClaude, AI_MODEL } from '@/lib/ai'
import { isShippingCostRequired } from '@/lib/deals/fees'
import { coerceNumber } from '@/lib/numeric'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export class TurnOrderError extends Error {}
export class InvalidStateError extends Error {}
export class GuardrailError extends Error {}

interface OfferRound {
  round: number
  offered_price: number
  offered_quantity: number | null
  proposed_delivery_date: string | null
  proposed_incoterms: string | null
  proposed_payment_terms: string | null
  shipping_cost: number | null
  notes: string | null
  offer_items: unknown[] | null
  by_org_id: string
  at: string
}

interface ListingRow {
  id: string; status: string; org_id: string; title: string
  target_price: number | null; currency: string; offer_count: number
  listing_type: string; shipping_cost: number | null
}

async function loadOfferWithListing(offerId: string) {
  const { data: offer } = await adminClient
    .from('marketplace_offers')
    .select('*, marketplace_listings(id, status, org_id, title, target_price, currency, offer_count, listing_type, shipping_cost)')
    .eq('id', offerId)
    .single()
  if (!offer) throw new InvalidStateError('Offer not found')

  const listing = offer.marketplace_listings as ListingRow
  return { offer, listing, listingOrgId: listing.org_id as string, offerorOrgId: offer.from_org_id as string }
}

/**
 * Idempotent: returns the existing room for this offer if one was already
 * created (on a prior counter/accept), otherwise creates a new private room
 * with both parties as participants.
 */
export async function ensureRoom(
  listingId: string,
  listingOrgId: string,
  offerorOrgId: string,
  listingTitle: string,
  offerId: string
): Promise<string> {
  const { data: offerRow } = await adminClient
    .from('marketplace_offers')
    .select('room_id')
    .eq('id', offerId)
    .single()

  const existingRoomId = offerRow?.room_id as string | undefined
  if (existingRoomId) return existingRoomId

  const { data: room, error: roomErr } = await adminClient
    .from('rooms')
    .insert({
      room_type: 'private',
      name: `${listingTitle} — Deal Room`,
      created_by_org_id: listingOrgId,
      status: 'active',
    })
    .select('id')
    .single()

  if (roomErr || !room) throw new Error('Failed to create room')

  const [{ data: listingUsers }, { data: offerorUsers }] = await Promise.all([
    adminClient.from('users').select('id').eq('org_id', listingOrgId).limit(1),
    adminClient.from('users').select('id').eq('org_id', offerorOrgId).limit(1),
  ])

  const participants = []
  if (listingUsers?.[0]) {
    participants.push({ room_id: room.id, org_id: listingOrgId, user_id: listingUsers[0].id, role: 'owner' })
  }
  if (offerorUsers?.[0]) {
    participants.push({ room_id: room.id, org_id: offerorOrgId, user_id: offerorUsers[0].id, role: 'participant' })
  }
  if (participants.length) {
    await adminClient.from('room_participants').insert(participants)
  }

  return room.id
}

export interface CounterTerms {
  offered_price: number
  offered_quantity?: number
  proposed_delivery_date?: string
  proposed_incoterms?: string
  proposed_payment_terms?: string
  shipping_cost?: number
  notes?: string
  offer_items?: unknown[]
}

/**
 * Submit a counter-offer. `maxRounds`, when provided, is enforced here as a
 * hard cap — the human-facing route never passes it (manual negotiation is
 * uncapped); the autonomous tick loop always does.
 */
export async function counterOffer(params: {
  offerId: string
  actingOrgId: string
  terms: CounterTerms
  maxRounds?: number
}): Promise<{ offer: Record<string, unknown>; roomId: string | null }> {
  const { offerId, actingOrgId, maxRounds } = params
  // The AI negotiation path sometimes writes a unit onto a numeric field
  // (e.g. "500MT") — coerce before it ever reaches the numeric DB columns.
  const terms: CounterTerms = {
    ...params.terms,
    offered_price: coerceNumber(params.terms.offered_price) ?? params.terms.offered_price,
    offered_quantity: coerceNumber(params.terms.offered_quantity) ?? undefined,
    shipping_cost: coerceNumber(params.terms.shipping_cost) ?? undefined,
  }
  const { offer, listing, listingOrgId, offerorOrgId } = await loadOfferWithListing(offerId)

  if (!['pending', 'countered'].includes(offer.status)) {
    throw new InvalidStateError('Cannot counter in the current state')
  }

  const rounds: OfferRound[] = Array.isArray(offer.offer_rounds) ? offer.offer_rounds : []
  const lastRound = rounds.length > 0 ? rounds[rounds.length - 1]! : null
  const isListingOwnerTurn = !lastRound || lastRound.by_org_id === offerorOrgId
  const isOfferorTurn = lastRound != null && lastRound.by_org_id === listingOrgId

  const isListingOwnerCounter = actingOrgId === listingOrgId && isListingOwnerTurn
  const isOfferorCounter = actingOrgId === offerorOrgId && isOfferorTurn
  if (!isListingOwnerCounter && !isOfferorCounter) {
    throw new TurnOrderError('Cannot counter in the current state')
  }

  const newRound = (offer.current_round ?? 1) + 1
  if (maxRounds != null && newRound > maxRounds) {
    throw new GuardrailError(`Round ${newRound} would exceed max_rounds (${maxRounds})`)
  }

  const counterorIsSupplier = (actingOrgId === offerorOrgId && listing.listing_type === 'po_request')
    || (actingOrgId === listingOrgId && listing.listing_type === 'product_service')
  const effectiveIncoterms = terms.proposed_incoterms ?? offer.proposed_incoterms
  const effectiveShippingCost = terms.shipping_cost ?? offer.shipping_cost
  if (counterorIsSupplier && isShippingCostRequired(effectiveIncoterms) && typeof effectiveShippingCost !== 'number') {
    throw new InvalidStateError(`shipping_cost is required for incoterm ${effectiveIncoterms}`)
  }

  const now = new Date().toISOString()
  const counterRound: OfferRound = {
    round: newRound,
    offered_price: terms.offered_price,
    offered_quantity: terms.offered_quantity ?? null,
    proposed_delivery_date: terms.proposed_delivery_date ?? null,
    proposed_incoterms: terms.proposed_incoterms ?? null,
    proposed_payment_terms: terms.proposed_payment_terms ?? null,
    shipping_cost: terms.shipping_cost ?? null,
    notes: terms.notes ?? null,
    offer_items: Array.isArray(terms.offer_items) ? terms.offer_items : null,
    by_org_id: actingOrgId,
    at: now,
  }

  let ai_analysis: string | null = offer.ai_analysis
  let ai_recommendation: string | null = offer.ai_recommendation
  try {
    const result = await callClaude({
      system: 'You are Strike AI. Analyze this trade counter-offer.',
      messages: [{
        role: 'user',
        content: `Listing target price: ${listing.target_price ?? 'not specified'} ${listing.currency}. Counter price: ${terms.offered_price}. Original offer price: ${offer.offered_price}. Write 1 sentence on how this counter compares, and 1 sentence on whether the offeror should Accept or Counter again. Be direct, no fluff.`,
      }],
      max_tokens: 300,
    })
    const text = result.text.trim()
    const parts = text.split(/(?<=[.!?])\s+/)
    ai_analysis = parts[0] ?? text
    ai_recommendation = parts.slice(1).join(' ') || null

    await adminClient.from('ai_usage').insert({
      org_id: actingOrgId,
      feature: 'insight',
      tokens_input: result.usage.input_tokens ?? 0,
      tokens_output: result.usage.output_tokens ?? 0,
      tokens_total: (result.usage.input_tokens ?? 0) + (result.usage.output_tokens ?? 0),
      model: AI_MODEL,
    })
  } catch {
    // non-fatal
  }

  await adminClient.from('marketplace_offers').update({
    status: 'countered',
    current_round: newRound,
    offer_rounds: [...rounds, counterRound],
    offered_price: terms.offered_price,
    offered_quantity: terms.offered_quantity ?? offer.offered_quantity,
    proposed_delivery_date: terms.proposed_delivery_date ?? offer.proposed_delivery_date,
    proposed_incoterms: terms.proposed_incoterms ?? offer.proposed_incoterms,
    proposed_payment_terms: terms.proposed_payment_terms ?? offer.proposed_payment_terms,
    shipping_cost: terms.shipping_cost ?? offer.shipping_cost,
    ai_analysis,
    ai_recommendation,
    updated_at: now,
  }).eq('id', offerId)

  // An AI-driven counter always passes maxRounds (see doc comment above); a
  // human never does. That's the one reliable signal here for whether to post
  // the round into the room as a plain system line or as an ai_suggestion
  // message carrying the agent's actual reasoning, so the counterparty (human
  // or their own agent) can see WHY the move was made, not just the number.
  const isAutonomous = maxRounds != null

  let roomId: string | null = null
  try {
    roomId = await ensureRoom(listing.id, listingOrgId, offerorOrgId, listing.title, offerId)
    await adminClient.from('marketplace_offers').update({ room_id: roomId }).eq('id', offerId)

    const { data: counteringOrg } = await adminClient
      .from('organizations').select('legal_name').eq('id', actingOrgId).single()
    const orgName = counteringOrg?.legal_name ?? 'A party'
    const headline = `Round ${newRound} — ${orgName} has countered at ${terms.offered_price} ${listing.currency}.`

    await adminClient.from('room_messages').insert({
      room_id: roomId,
      content: isAutonomous && terms.notes ? `${headline}\n\n${terms.notes}` : headline,
      message_type: isAutonomous ? 'ai_suggestion' : 'system',
      status: 'visible',
    })
  } catch {
    // non-fatal
  }

  const notifyOrgId = actingOrgId === listingOrgId ? offerorOrgId : listingOrgId
  const { data: notifyUsers } = await adminClient.from('users').select('id').eq('org_id', notifyOrgId)
  if (notifyUsers?.length) {
    await adminClient.from('notifications').insert(
      notifyUsers.map((u: { id: string }) => ({
        user_id: u.id, event: 'offer_countered',
        title: 'Counter offer received',
        body: `A counter offer on "${listing.title}" has been submitted at ${terms.offered_price} ${listing.currency}.`,
        deep_link: roomId ? `/rooms/${roomId}` : `/marketplace/listings/${listing.id}`,
        read: false,
      }))
    )
  }

  const updatedOffer = await adminClient.from('marketplace_offers').select('*').eq('id', offerId).single()
  return { offer: updatedOffer.data as Record<string, unknown>, roomId }
}

/**
 * Accept an offer — creates the deal. This is the ONLY place a deal is ever
 * created from a marketplace offer; callers (human route, the finalization-
 * approval tool handler) must never bypass it.
 */
export async function acceptOffer(params: {
  offerId: string
  actingOrgId: string
}): Promise<{ offer: Record<string, unknown>; deal: Record<string, unknown>; roomId: string | null }> {
  const { offerId, actingOrgId } = params
  const { offer, listing, listingOrgId, offerorOrgId } = await loadOfferWithListing(offerId)

  if (actingOrgId !== offerorOrgId && actingOrgId !== listingOrgId) {
    throw new InvalidStateError('Access denied')
  }
  if (!['pending', 'countered'].includes(offer.status)) {
    throw new InvalidStateError('Offer cannot be accepted in its current state')
  }

  const now = new Date().toISOString()
  await adminClient.from('marketplace_offers').update({ status: 'accepted', updated_at: now }).eq('id', offerId)

  // Derive buyer/supplier from listing_type — the canonical source of truth.
  let buyerOrgId: string
  let supplierOrgId: string
  if (listing.listing_type === 'po_request') {
    buyerOrgId = listingOrgId
    supplierOrgId = offerorOrgId
  } else {
    supplierOrgId = listingOrgId
    buyerOrgId = offerorOrgId
  }

  // offered_price is already the grand total (see computeOfferTotal in the
  // listing detail page — it sums quantity * unit_price across line items
  // before ever reaching the backend), not a per-unit rate. Multiplying by
  // offered_quantity again here inflated deals.total_value by a factor of
  // the quantity on every accepted offer with offered_quantity > 1.
  const totalValue = offer.offered_price

  const shippingCost: number | null = listing.listing_type === 'po_request'
    ? (offer.shipping_cost ?? null)
    : (listing.shipping_cost ?? null)

  let receivingBankAccountId: string | null = offer.bank_account_id ?? null
  if (!receivingBankAccountId && listing.listing_type === 'product_service') {
    const { data: primaryAcct } = await adminClient
      .from('bank_accounts')
      .select('id')
      .eq('entity_type', 'organization')
      .eq('entity_id', listingOrgId)
      .eq('is_primary', true)
      .maybeSingle()
    receivingBankAccountId = primaryAcct?.id ?? null
  }

  const { data: deal, error: dealErr } = await adminClient
    .from('deals')
    .insert({
      listing_id: listing.id,
      offer_id: offerId,
      buyer_org_id: buyerOrgId,
      supplier_org_id: supplierOrgId,
      agreed_price: offer.offered_price,
      agreed_quantity: offer.offered_quantity,
      agreed_currency: listing.currency,
      agreed_delivery_date: offer.proposed_delivery_date,
      agreed_incoterms: offer.proposed_incoterms,
      agreed_payment_terms: offer.proposed_payment_terms,
      status: 'agreed',
      agreed_at: now,
      total_value: totalValue,
      shipping_cost: shippingCost,
      deal_source: 'marketplace',
      financing_requested: false,
      receiving_bank_account_id: receivingBankAccountId,
    })
    .select()
    .single()

  if (dealErr || !deal) throw new Error('Failed to create deal')

  await adminClient.from('marketplace_offers').update({ deal_id: deal.id }).eq('id', offerId)
  await adminClient.from('marketplace_listings').update({
    status: 'matched',
    matched_deal_id: deal.id,
  }).eq('id', listing.id)

  let roomId: string | null = null
  try {
    roomId = await ensureRoom(listing.id, listingOrgId, offerorOrgId, listing.title, offerId)
    await adminClient.from('deals').update({ room_id: roomId }).eq('id', deal.id)
    // Reverse link too — the deal-summary banner in the room header reads
    // rooms.deal_id, which was never populated by this path before.
    await adminClient.from('rooms').update({ deal_id: deal.id }).eq('id', roomId)
    await adminClient.from('marketplace_offers').update({ room_id: roomId }).eq('id', offerId)
    await adminClient.from('room_messages').insert({
      room_id: roomId,
      content: 'Deal agreed. Both parties have confirmed terms.',
      message_type: 'system',
      status: 'visible',
    })
  } catch {
    // non-fatal
  }

  const [{ data: listingOrgUsers }, { data: offerorOrgUsers }] = await Promise.all([
    adminClient.from('users').select('id').eq('org_id', listingOrgId),
    adminClient.from('users').select('id').eq('org_id', offerorOrgId),
  ])
  const notifyUsers = [...(listingOrgUsers ?? []), ...(offerorOrgUsers ?? [])]
  if (notifyUsers.length) {
    await adminClient.from('notifications').insert(
      notifyUsers.map((u: { id: string }) => ({
        user_id: u.id, event: 'deal_agreed',
        title: 'Deal agreed',
        body: `A deal has been agreed for "${listing.title}".`,
        deep_link: roomId ? `/rooms/${roomId}` : `/deals/${deal.id}`,
        read: false,
      }))
    )
  }

  return { offer: { ...offer, status: 'accepted' }, deal, roomId }
}

export async function rejectOffer(params: {
  offerId: string
  actingOrgId: string
  /** Set only by the autonomous tick loop — posts the agent's reasoning into
   *  the deal room as an ai_suggestion message. Human rejects via the UI never
   *  pass this, so they keep the existing notification-only behavior. */
  reasoning?: string
}): Promise<{ offer: Record<string, unknown> }> {
  const { offerId, actingOrgId, reasoning } = params
  const { offer, listing, listingOrgId, offerorOrgId } = await loadOfferWithListing(offerId)
  void offerorOrgId

  if (actingOrgId !== listingOrgId) {
    throw new InvalidStateError('Only the listing owner can reject offers')
  }
  if (!['pending', 'countered'].includes(offer.status)) {
    throw new InvalidStateError('Offer cannot be rejected in its current state')
  }

  await adminClient.from('marketplace_offers').update({ status: 'rejected' }).eq('id', offerId)

  if (reasoning) {
    try {
      const { data: rejectingOrg } = await adminClient
        .from('organizations').select('legal_name').eq('id', actingOrgId).single()
      const existingRoomId = (offer as { room_id?: string | null }).room_id
      const roomId = existingRoomId ?? await ensureRoom(listing.id, listingOrgId, offerorOrgId, listing.title, offerId)
      if (!existingRoomId) await adminClient.from('marketplace_offers').update({ room_id: roomId }).eq('id', offerId)
      await adminClient.from('room_messages').insert({
        room_id: roomId,
        content: `${rejectingOrg?.legal_name ?? 'A party'} has rejected the offer.\n\n${reasoning}`,
        message_type: 'ai_suggestion',
        status: 'visible',
      })
    } catch {
      // non-fatal
    }
  }

  const { data: offerorUsers } = await adminClient.from('users').select('id').eq('org_id', offer.from_org_id)
  if (offerorUsers?.length) {
    await adminClient.from('notifications').insert(
      offerorUsers.map((u: { id: string }) => ({
        user_id: u.id, event: 'offer_rejected',
        title: 'Offer rejected',
        body: `Your offer on "${listing.title}" has been rejected.`,
        deep_link: `/marketplace/listings/${listing.id}`,
        read: false,
      }))
    )
  }

  return { offer: { ...offer, status: 'rejected' } }
}
