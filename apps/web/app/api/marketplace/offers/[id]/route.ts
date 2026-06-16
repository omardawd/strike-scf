import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { callClaude, AI_MODEL } from '@/lib/ai'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type Action = 'counter' | 'accept' | 'reject' | 'withdraw' | 'create_room'

interface ActionBody {
  action: Action
  offered_price?: number
  offered_quantity?: number
  proposed_delivery_date?: string
  proposed_incoterms?: string
  proposed_payment_terms?: string
  notes?: string
  offer_items?: unknown[]
}

async function ensureRoom(
  listingId: string,
  listingOrgId: string,
  offerorOrgId: string,
  listingTitle: string,
  offerId: string
): Promise<string> {
  // Check if room already exists for this listing+offeror pair
  const existingMeta = await adminClient
    .from('marketplace_offers')
    .select('id')
    .eq('id', offerId)
    .not('metadata->room_id', 'is', null)
    .maybeSingle()

  // We'll look directly for a room linked to this offer
  const { data: offerRow } = await adminClient
    .from('marketplace_offers')
    .select('metadata')
    .eq('id', offerId)
    .single()

  const existingRoomId = (offerRow?.metadata as Record<string, unknown> | null)?.room_id as string | undefined
  if (existingRoomId) return existingRoomId

  // Also check if there's any room for these two orgs + this listing
  // (could have been created via a different code path)
  // We skip that for simplicity and always check offer metadata first.

  // Create a new private room
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

  // Insert participants for both orgs. We need a user for each org to fill user_id.
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: offerId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!userData?.org_id) return NextResponse.json({ error: 'User not found or not linked to an org' }, { status: 401 })

  let body: ActionBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { action, offered_price, offered_quantity, proposed_delivery_date,
    proposed_incoterms, proposed_payment_terms, notes, offer_items } = body

  if (!['counter', 'accept', 'reject', 'withdraw', 'create_room'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  // Fetch offer with listing data
  const { data: offer } = await adminClient
    .from('marketplace_offers')
    .select('*, marketplace_listings(id, status, org_id, title, target_price, currency, offer_count, listing_type)')
    .eq('id', offerId)
    .single()

  if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })

  const listing = offer.marketplace_listings as {
    id: string; status: string; org_id: string; title: string;
    target_price: number | null; currency: string; offer_count: number; listing_type: string
  }
  const listingOrgId: string = listing.org_id
  const offerorOrgId: string = offer.from_org_id

  // Auth: must be either the offeror org OR the listing's org
  if (userData.org_id !== offerorOrgId && userData.org_id !== listingOrgId) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const now = new Date().toISOString()

  // ── CREATE_ROOM ───────────────────────────────────────────
  if (action === 'create_room') {
    try {
      const roomId = await ensureRoom(listing.id, listingOrgId, offerorOrgId, listing.title, offerId)
      await adminClient.from('marketplace_offers').update({
        metadata: { ...(offer.metadata ?? {}), room_id: roomId },
      }).eq('id', offerId)
      return NextResponse.json({ room_id: roomId })
    } catch {
      return NextResponse.json({ error: 'Failed to create room' }, { status: 500 })
    }
  }

  // ── WITHDRAW ───────────────────────────────────────────────
  if (action === 'withdraw') {
    if (userData.org_id !== offerorOrgId) {
      return NextResponse.json({ error: 'Only the offeror can withdraw' }, { status: 403 })
    }
    if (!['pending', 'countered'].includes(offer.status)) {
      return NextResponse.json({ error: 'Offer cannot be withdrawn in its current state' }, { status: 409 })
    }
    await adminClient.from('marketplace_offers').update({ status: 'withdrawn' }).eq('id', offerId)

    // Notify listing org
    const { data: listingUsers } = await adminClient.from('users').select('id').eq('org_id', listingOrgId)
    if (listingUsers?.length) {
      await adminClient.from('notifications').insert(
        listingUsers.map((u: { id: string }) => ({
          user_id: u.id, event: 'offer_withdrawn',
          title: 'Offer withdrawn',
          body: `An offer on "${listing.title}" has been withdrawn.`,
          deep_link: `/marketplace/listings/${listing.id}`,
          read: false,
        }))
      )
    }
    return NextResponse.json({ offer: { ...offer, status: 'withdrawn' } })
  }

  // ── REJECT ────────────────────────────────────────────────
  if (action === 'reject') {
    if (userData.org_id !== listingOrgId) {
      return NextResponse.json({ error: 'Only the listing owner can reject offers' }, { status: 403 })
    }
    if (!['pending', 'countered'].includes(offer.status)) {
      return NextResponse.json({ error: 'Offer cannot be rejected in its current state' }, { status: 409 })
    }
    await adminClient.from('marketplace_offers').update({ status: 'rejected' }).eq('id', offerId)

    // Notify offeror
    const { data: offerorUsers } = await adminClient.from('users').select('id').eq('org_id', offerorOrgId)
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
    return NextResponse.json({ offer: { ...offer, status: 'rejected' } })
  }

  // ── COUNTER ───────────────────────────────────────────────
  if (action === 'counter') {
    if (!['pending', 'countered'].includes(offer.status)) {
      return NextResponse.json({ error: 'Cannot counter in the current state' }, { status: 409 })
    }
    // Turn-based: whoever received the last counter gets to counter next.
    // No rounds yet (initial offer) → listing owner goes first.
    const rounds = Array.isArray(offer.offer_rounds) ? offer.offer_rounds : []
    const lastRound = rounds.length > 0 ? rounds[rounds.length - 1] : null
    const isListingOwnerTurn = !lastRound || (lastRound as any).by_org_id === offerorOrgId
    const isOfferorTurn = lastRound != null && (lastRound as any).by_org_id === listingOrgId

    const isListingOwnerCounter = userData.org_id === listingOrgId && isListingOwnerTurn
    const isOfferorCounter = userData.org_id === offerorOrgId && isOfferorTurn
    if (!isListingOwnerCounter && !isOfferorCounter) {
      return NextResponse.json({ error: 'Cannot counter in the current state' }, { status: 409 })
    }
    if (typeof offered_price !== 'number') {
      return NextResponse.json({ error: 'offered_price is required for counter' }, { status: 400 })
    }

    const newRound = (offer.current_round ?? 1) + 1
    const counterRound = {
      round: newRound,
      offered_price,
      offered_quantity: offered_quantity ?? null,
      proposed_delivery_date: proposed_delivery_date ?? null,
      proposed_incoterms: proposed_incoterms ?? null,
      proposed_payment_terms: proposed_payment_terms ?? null,
      notes: notes ?? null,
      offer_items: Array.isArray(offer_items) ? offer_items : null,
      by_org_id: userData.org_id,
      at: now,
    }

    // AI analysis for counter terms
    let ai_analysis: string | null = offer.ai_analysis
    let ai_recommendation: string | null = offer.ai_recommendation
    try {
      const result = await callClaude({
        system: 'You are Strike AI. Analyze this trade counter-offer.',
        messages: [{
          role: 'user',
          content: `Listing target price: ${listing.target_price ?? 'not specified'} ${listing.currency}. Counter price: ${offered_price}. Original offer price: ${offer.offered_price}. Write 1 sentence on how this counter compares, and 1 sentence on whether the offeror should Accept or Counter again. Be direct, no fluff.`,
        }],
        max_tokens: 300,
      })
      const text = result.text.trim()
      const parts = text.split(/(?<=[.!?])\s+/)
      ai_analysis = parts[0] ?? text
      ai_recommendation = parts.slice(1).join(' ') || null

      await adminClient.from('ai_usage').insert({
        user_id: userData.id,
        org_id: userData.org_id,
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
      offered_price,
      offered_quantity: offered_quantity ?? offer.offered_quantity,
      proposed_delivery_date: proposed_delivery_date ?? offer.proposed_delivery_date,
      proposed_incoterms: proposed_incoterms ?? offer.proposed_incoterms,
      proposed_payment_terms: proposed_payment_terms ?? offer.proposed_payment_terms,
      ai_analysis,
      ai_recommendation,
      updated_at: now,
    }).eq('id', offerId)

    // Create room if not exists
    let roomId: string | null = null
    try {
      roomId = await ensureRoom(listing.id, listingOrgId, offerorOrgId, listing.title, offerId)

      // Set room_id on offer metadata
      await adminClient.from('marketplace_offers').update({
        metadata: { ...(offer.metadata ?? {}), room_id: roomId },
      }).eq('id', offerId)

      // Post system message
      const { data: counteringOrg } = await adminClient
        .from('organizations').select('legal_name').eq('id', userData.org_id).single()
      await adminClient.from('room_messages').insert({
        room_id: roomId,
        content: `Round ${newRound} — ${counteringOrg?.legal_name ?? 'A party'} has countered at ${offered_price} ${listing.currency}.`,
        message_type: 'system',
        status: 'visible',
      })
    } catch {
      // non-fatal
    }

    // Notify the other party
    const notifyOrgId = userData.org_id === listingOrgId ? offerorOrgId : listingOrgId
    const { data: notifyUsers } = await adminClient.from('users').select('id').eq('org_id', notifyOrgId)
    if (notifyUsers?.length) {
      await adminClient.from('notifications').insert(
        notifyUsers.map((u: { id: string }) => ({
          user_id: u.id, event: 'offer_countered',
          title: 'Counter offer received',
          body: `A counter offer on "${listing.title}" has been submitted at ${offered_price} ${listing.currency}.`,
          deep_link: roomId ? `/rooms/${roomId}` : `/marketplace/listings/${listing.id}`,
          read: false,
        }))
      )
    }

    const updatedOffer = await adminClient
      .from('marketplace_offers').select('*').eq('id', offerId).single()
    return NextResponse.json({ offer: updatedOffer.data, room_id: roomId })
  }

  // ── ACCEPT ────────────────────────────────────────────────
  if (action === 'accept') {
    if (!['pending', 'countered'].includes(offer.status)) {
      return NextResponse.json({ error: 'Offer cannot be accepted in its current state' }, { status: 409 })
    }

    // Update offer status
    await adminClient.from('marketplace_offers').update({ status: 'accepted', updated_at: now }).eq('id', offerId)

    // Derive buyer/supplier from listing_type — the canonical source of truth.
    // po_request: poster = buyer (anchor wanting goods), offeror = seller (supplier)
    // product_service: poster = seller (supplier offering goods), offeror = buyer (anchor)
    let buyerOrgId: string
    let supplierOrgId: string
    if (listing.listing_type === 'po_request') {
      buyerOrgId = listingOrgId
      supplierOrgId = offerorOrgId
    } else {
      supplierOrgId = listingOrgId
      buyerOrgId = offerorOrgId
    }

    const totalValue = offer.offered_price * (offer.offered_quantity ?? 1)

    // Determine receiving_bank_account_id:
    // - po_request: offeror is supplier → bank_account_id comes from the offer
    // - product_service: listing org is supplier → look up their primary bank account
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

    // Create deal
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
        deal_source: 'marketplace',
        financing_requested: false,
        receiving_bank_account_id: receivingBankAccountId,
      })
      .select()
      .single()

    if (dealErr || !deal) {
      return NextResponse.json({ error: 'Failed to create deal' }, { status: 500 })
    }

    // Link deal back to the offer so the UI can show "View Deal →"
    await adminClient.from('marketplace_offers').update({ deal_id: deal.id }).eq('id', offerId)

    // Update listing: matched + linked deal
    await adminClient.from('marketplace_listings').update({
      status: 'matched',
      matched_deal_id: deal.id,
    }).eq('id', listing.id)

    // Ensure room exists and link to deal
    let roomId: string | null = null
    try {
      roomId = await ensureRoom(listing.id, listingOrgId, offerorOrgId, listing.title, offerId)

      // Link room to deal
      await adminClient.from('deals').update({ room_id: roomId }).eq('id', deal.id)
      await adminClient.from('marketplace_offers').update({
        metadata: { ...(offer.metadata ?? {}), room_id: roomId },
      }).eq('id', offerId)

      // System message in room
      await adminClient.from('room_messages').insert({
        room_id: roomId,
        content: 'Deal agreed. Both parties have confirmed terms.',
        message_type: 'system',
        status: 'visible',
      })
    } catch {
      // non-fatal
    }

    // Notify both orgs
    const [{ data: listingOrgUsers }, { data: offerorOrgUsers }] = await Promise.all([
      adminClient.from('users').select('id').eq('org_id', listingOrgId),
      adminClient.from('users').select('id').eq('org_id', offerorOrgId),
    ])

    const notifyUsers = [
      ...(listingOrgUsers ?? []),
      ...(offerorOrgUsers ?? []),
    ]
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

    return NextResponse.json({ offer: { ...offer, status: 'accepted' }, deal })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
