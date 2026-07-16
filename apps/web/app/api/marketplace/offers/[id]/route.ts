import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import {
  ensureRoom,
  counterOffer,
  acceptOffer,
  rejectOffer,
  TurnOrderError,
  InvalidStateError,
} from '@/lib/marketplace/offer-actions'

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
  shipping_cost?: number
  notes?: string
  offer_items?: unknown[]
}

// GET a single offer — used by the deal detail page to show the actual
// negotiated line-item breakdown (the listing's own line items are the
// pre-negotiation starting point, not what was actually agreed).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: offerId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, org_id')
    .eq('id', user.id)
    .single()
  if (!userData) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: offer } = await adminClient
    .from('marketplace_offers')
    .select('id, listing_id, from_org_id, offered_price, offer_rounds, current_round, marketplace_listings(org_id)')
    .eq('id', offerId)
    .single()

  if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })

  const listingRel = offer.marketplace_listings as unknown as { org_id: string } | { org_id: string }[] | null
  const listingOrgId = Array.isArray(listingRel) ? listingRel[0]?.org_id : listingRel?.org_id
  const isParticipant = userData.org_id === offer.from_org_id || userData.org_id === listingOrgId
  if (!isParticipant) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

  return NextResponse.json({
    id: offer.id,
    listing_id: offer.listing_id,
    offered_price: offer.offered_price,
    current_round: offer.current_round,
    offer_rounds: offer.offer_rounds,
  })
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
    proposed_incoterms, proposed_payment_terms, shipping_cost, notes, offer_items } = body

  if (!['counter', 'accept', 'reject', 'withdraw', 'create_room'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  // Fetch offer with listing data
  const { data: offer } = await adminClient
    .from('marketplace_offers')
    .select('*, marketplace_listings(id, status, org_id, title, target_price, currency, offer_count, listing_type, shipping_cost)')
    .eq('id', offerId)
    .single()

  if (!offer) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })

  const listing = offer.marketplace_listings as {
    id: string; status: string; org_id: string; title: string;
    target_price: number | null; currency: string; offer_count: number; listing_type: string; shipping_cost: number | null
  }
  const listingOrgId: string = listing.org_id
  const offerorOrgId: string = offer.from_org_id

  // Auth: must be either the offeror org OR the listing's org
  if (userData.org_id !== offerorOrgId && userData.org_id !== listingOrgId) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

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
    try {
      const result = await rejectOffer({ offerId, actingOrgId: userData.org_id })
      return NextResponse.json(result)
    } catch (err) {
      if (err instanceof InvalidStateError) return NextResponse.json({ error: err.message }, { status: 409 })
      return NextResponse.json({ error: 'Failed to reject offer' }, { status: 500 })
    }
  }

  // ── COUNTER ───────────────────────────────────────────────
  if (action === 'counter') {
    if (typeof offered_price !== 'number') {
      return NextResponse.json({ error: 'offered_price is required for counter' }, { status: 400 })
    }
    try {
      const { offer: updatedOffer, roomId } = await counterOffer({
        offerId,
        actingOrgId: userData.org_id,
        terms: {
          offered_price, offered_quantity, proposed_delivery_date, proposed_incoterms,
          proposed_payment_terms, shipping_cost, notes, offer_items,
        },
        // No maxRounds here — manual, human-driven negotiation stays uncapped.
      })
      return NextResponse.json({ offer: updatedOffer, room_id: roomId })
    } catch (err) {
      if (err instanceof TurnOrderError || err instanceof InvalidStateError) {
        return NextResponse.json({ error: err.message }, { status: 409 })
      }
      return NextResponse.json({ error: 'Failed to submit counter' }, { status: 500 })
    }
  }

  // ── ACCEPT ────────────────────────────────────────────────
  if (action === 'accept') {
    try {
      const { offer: updatedOffer, deal } = await acceptOffer({ offerId, actingOrgId: userData.org_id })
      return NextResponse.json({ offer: updatedOffer, deal })
    } catch (err) {
      if (err instanceof InvalidStateError) return NextResponse.json({ error: err.message }, { status: 409 })
      return NextResponse.json({ error: 'Failed to accept offer' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
