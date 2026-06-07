import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { callClaude, AI_MODEL } from '@/lib/ai'
import type { CreateListingPayload } from '@strike-scf/types'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, role, org_id, bank_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const category    = searchParams.get('category')
  const listingType = searchParams.get('listing_type')
  const sort        = searchParams.get('sort') ?? 'newest'
  const search      = searchParams.get('search')
  const mine        = searchParams.get('mine') === 'true' || searchParams.get('own') === 'true'
  const page        = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit       = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '20')))
  const offset      = (page - 1) * limit

  let query = adminClient
    .from('marketplace_listings')
    .select('*', { count: 'exact' })

  if (mine && me.org_id) {
    // Return only the caller's own org's listings (all statuses)
    query = query.eq('org_id', me.org_id)
  } else {
    // Marketplace browse: active + network-visible, exclude own org
    query = query.eq('status', 'active').eq('network_visible', true)
    if (me.org_id) {
      query = query.neq('org_id', me.org_id)
    }
  }

  if (category) {
    query = query.eq('category', category)
  }

  if (listingType) {
    query = query.eq('listing_type', listingType)
  }

  if (search) {
    query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`)
  }

  switch (sort) {
    case 'price_asc':
      query = query.order('target_price', { ascending: true, nullsFirst: false })
      break
    case 'price_desc':
      query = query.order('target_price', { ascending: false, nullsFirst: false })
      break
    default:
      query = query.order('created_at', { ascending: false })
  }

  query = query.range(offset, offset + limit - 1)

  const { data: listings, count, error } = await query

  if (error) {
    console.error('Listings fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch listings' }, { status: 500 })
  }

  // Batch-fetch poster org data
  const orgIds = [...new Set((listings ?? []).map((l: any) => l.org_id as string))]
  const orgsMap: Record<string, any> = {}

  if (orgIds.length > 0) {
    const { data: orgs } = await adminClient
      .from('organizations')
      .select('id, legal_name, doing_business_as, type, passport_score, risk_tier, trade_count_total, trade_volume_total, country_of_origin, description')
      .in('id', orgIds)

    for (const org of orgs ?? []) {
      orgsMap[org.id] = org
    }
  }

  const result = (listings ?? []).map((listing: any) => ({
    listing,
    poster_org: orgsMap[listing.org_id] ?? null,
    poster_passport_narrative: null,
  }))

  return NextResponse.json({
    listings: result,
    total: count ?? 0,
    page,
    hasMore: (count ?? 0) > offset + limit,
  })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  // Only org users (those with an org_id) can create listings
  if (!me.org_id) {
    return NextResponse.json({ error: 'Only organization members can create listings' }, { status: 403 })
  }

  const { data: org } = await adminClient
    .from('organizations')
    .select('status')
    .eq('id', me.org_id)
    .single()

  if (!org || org.status !== 'active') {
    return NextResponse.json({ error: 'Organization must be active to post listings' }, { status: 403 })
  }

  let body: CreateListingPayload & { status?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.listing_type || !body.title?.trim()) {
    return NextResponse.json({ error: 'listing_type and title are required' }, { status: 400 })
  }

  const isDraft = body.status === 'draft'

  const { data: listing, error: insertError } = await adminClient
    .from('marketplace_listings')
    .insert({
      org_id: me.org_id,
      listing_type: body.listing_type,
      title: body.title.trim(),
      description: body.description ?? null,
      category: body.category ?? null,
      subcategory: body.subcategory ?? null,
      tags: body.tags ?? null,
      quantity: body.quantity ?? null,
      unit: body.unit ?? null,
      target_price: body.target_price ?? null,
      currency: body.currency ?? 'USD',
      incoterms: body.incoterms ?? null,
      delivery_location: body.delivery_location ?? null,
      delivery_deadline: body.delivery_deadline ?? null,
      payment_terms: body.payment_terms ?? null,
      origin_country: body.origin_country ?? null,
      expires_at: body.expires_at ?? null,
      status: isDraft ? 'draft' : 'active',
      network_visible: !isDraft,
    })
    .select()
    .single()

  if (insertError || !listing) {
    console.error('Listing insert error:', insertError)
    return NextResponse.json({ error: 'Failed to create listing' }, { status: 500 })
  }

  if (!isDraft) {
    try {
      const promptLines = [
        `Title: ${listing.title}`,
        `Description: ${listing.description ?? 'N/A'}`,
        `Category: ${listing.category ?? 'N/A'}`,
        `Quantity: ${listing.quantity != null ? `${listing.quantity} ${listing.unit ?? ''}`.trim() : 'N/A'}`,
        `Target price: ${listing.target_price != null ? `${listing.target_price} ${listing.currency}` : 'N/A'}`,
        `Delivery location: ${listing.delivery_location ?? 'N/A'}`,
      ]

      const { text, usage } = await callClaude({
        system: 'Write a 1-sentence summary of this trade listing for a financial marketplace. Be factual and specific.',
        messages: [{ role: 'user', content: promptLines.join('\n') }],
        max_tokens: 200,
      })

      const ai_summary = text.trim().replace(/\n+/g, ' ')

      await adminClient
        .from('marketplace_listings')
        .update({ ai_summary })
        .eq('id', listing.id)

      listing.ai_summary = ai_summary

      await adminClient.from('ai_usage').insert({
        user_id: user.id,
        org_id: me.org_id,
        feature: 'insight',
        tokens_input: usage.input_tokens ?? 0,
        tokens_output: usage.output_tokens ?? 0,
        tokens_total: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
        model: AI_MODEL,
      })
    } catch (err) {
      // Non-fatal — listing is created without an AI summary
    }
  }

  return NextResponse.json({ listing }, { status: 201 })
}
