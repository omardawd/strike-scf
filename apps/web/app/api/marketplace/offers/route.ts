import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { callClaude, AI_MODEL } from '@/lib/ai'
import type { SubmitOfferPayload } from '@strike-scf/types'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!userData?.org_id) return NextResponse.json({ error: 'User not found or not linked to an org' }, { status: 401 })

  // Only org users with active status may submit offers
  const { data: orgData } = await adminClient
    .from('organizations')
    .select('id, status, legal_name, passport_score')
    .eq('id', userData.org_id)
    .single()
  if (!orgData) return NextResponse.json({ error: 'Organization not found' }, { status: 403 })
  if (orgData.status !== 'active') {
    return NextResponse.json({ error: 'Organization must be active to submit offers' }, { status: 403 })
  }

  let body: SubmitOfferPayload
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { listing_id, offered_price, offered_quantity, proposed_delivery_date,
    proposed_incoterms, proposed_payment_terms, notes } = body

  if (!listing_id || typeof offered_price !== 'number') {
    return NextResponse.json({ error: 'listing_id and offered_price are required' }, { status: 400 })
  }

  // Fetch listing and verify it's active
  const { data: listing } = await adminClient
    .from('marketplace_listings')
    .select('id, status, org_id, title, target_price, currency')
    .eq('id', listing_id)
    .single()
  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
  if (listing.status !== 'active') {
    return NextResponse.json({ error: 'Listing is not accepting offers' }, { status: 409 })
  }
  if (listing.org_id === userData.org_id) {
    return NextResponse.json({ error: 'Cannot offer on your own listing' }, { status: 403 })
  }

  // Check for existing non-withdrawn/rejected offer from this org
  const { data: existingOffer } = await adminClient
    .from('marketplace_offers')
    .select('id, status')
    .eq('listing_id', listing_id)
    .eq('from_org_id', userData.org_id)
    .not('status', 'in', '("withdrawn","rejected","expired")')
    .maybeSingle()
  if (existingOffer) {
    return NextResponse.json({ error: 'You already have an active offer on this listing' }, { status: 409 })
  }

  const now = new Date().toISOString()
  const firstRound = {
    round: 1,
    offered_price,
    offered_quantity: offered_quantity ?? null,
    proposed_delivery_date: proposed_delivery_date ?? null,
    proposed_incoterms: proposed_incoterms ?? null,
    proposed_payment_terms: proposed_payment_terms ?? null,
    notes: notes ?? null,
    by_org_id: userData.org_id,
    at: now,
  }

  const { data: newOffer, error: insertError } = await adminClient
    .from('marketplace_offers')
    .insert({
      listing_id,
      from_org_id: userData.org_id,
      offered_price,
      offered_quantity: offered_quantity ?? null,
      proposed_delivery_date: proposed_delivery_date ?? null,
      proposed_incoterms: proposed_incoterms ?? null,
      proposed_payment_terms: proposed_payment_terms ?? null,
      notes: notes ?? null,
      status: 'pending',
      current_round: 1,
      offer_rounds: [firstRound],
    })
    .select()
    .single()

  if (insertError || !newOffer) {
    return NextResponse.json({ error: 'Failed to create offer' }, { status: 500 })
  }

  // Increment listing offer_count
  await adminClient
    .from('marketplace_listings')
    .update({ offer_count: (listing as any).offer_count + 1 })
    .eq('id', listing_id)

  // Call Claude for AI analysis
  let ai_analysis: string | null = null
  let ai_recommendation: string | null = null
  try {
    const result = await callClaude({
      system: 'You are Strike AI. Analyze this trade offer.',
      messages: [{
        role: 'user',
        content: `Listing target price: ${listing.target_price ?? 'not specified'} ${listing.currency}. Offer price: ${offered_price}. Offeror PassportScore: ${orgData.passport_score ?? 'N/A'}. Write 1 sentence on how this offer compares to the listing price, and 1 sentence recommendation (Accept/Counter/Reject) with brief reasoning. Be direct, no fluff.`,
      }],
      max_tokens: 300,
    })

    const text = result.text.trim()
    const parts = text.split(/(?<=[.!?])\s+/)
    ai_analysis = parts[0] ?? text
    ai_recommendation = parts.slice(1).join(' ') || null

    // Update offer with AI fields
    await adminClient
      .from('marketplace_offers')
      .update({ ai_analysis, ai_recommendation })
      .eq('id', newOffer.id)

    // Log AI usage
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
    // AI failure is non-fatal
  }

  // Notify all users of the listing org
  const { data: listingOrgUsers } = await adminClient
    .from('users')
    .select('id')
    .eq('org_id', listing.org_id)

  if (listingOrgUsers?.length) {
    await adminClient.from('notifications').insert(
      listingOrgUsers.map((u: { id: string }) => ({
        user_id: u.id,
        event: 'offer_received',
        title: 'New offer received',
        body: `${orgData.legal_name ?? 'An organization'} submitted an offer of ${offered_price} ${listing.currency} on "${listing.title}"`,
        deep_link: `/marketplace/listings/${listing_id}`,
        read: false,
      }))
    )
  }

  return NextResponse.json({
    offer: { ...newOffer, ai_analysis, ai_recommendation },
  }, { status: 201 })
}
