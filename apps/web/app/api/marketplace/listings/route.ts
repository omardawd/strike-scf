import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { callClaude, AI_MODEL } from '@/lib/ai'
import type { CreateListingPayload } from '@strike-scf/types'
import { getVisibilityFilter, buildListingVisibilityOr } from '@/lib/networks/visibility'

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
  const networkId   = searchParams.get('network_id')
  const page        = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit       = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '20')))
  const offset      = (page - 1) * limit

  // Ghost mode: if org is not network_visible, return empty
  if (me.org_id) {
    const { data: org } = await adminClient
      .from('organizations')
      .select('network_visible')
      .eq('id', me.org_id)
      .single()
    if (org && org.network_visible === false) {
      return NextResponse.json({ listings: [], total: 0, page, hasMore: false })
    }
  }

  let query = adminClient
    .from('marketplace_listings')
    .select('*', { count: 'exact' })

  if (mine && me.org_id) {
    // Return only the caller's own org's listings (all statuses)
    query = query.eq('org_id', me.org_id)
  } else if (networkId) {
    // Network-specific browse: only listings in this network
    query = query.eq('network_id', networkId).eq('status', 'active')
  } else {
    // Marketplace browse: apply visibility filter
    query = query.eq('status', 'active').eq('network_visible', true)
    if (me.org_id) {
      query = query.neq('org_id', me.org_id)
      // Apply network visibility filter for org users
      const visFilter = await getVisibilityFilter(adminClient, me.org_id)
      const orFilter = buildListingVisibilityOr(visFilter, me.org_id)
      query = (query as any).or(orFilter)
    } else {
      // Non-org user (bank/admin): public listings only
      query = (query as any).eq('visibility', 'public')
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
      .select('id, legal_name, doing_business_as, type, passport_score, risk_tier, trade_count_total, trade_volume_total, country_of_origin, description, network_visible')
      .in('id', orgIds)

    for (const org of orgs ?? []) {
      orgsMap[org.id] = org
    }
  }

  // TD.5 — ghost enforcement: NEVER surface a listing whose CREATOR org is a ghost
  // (network_visible=false) to the marketplace. The service role bypasses RLS, so
  // this manual filter is required. The `mine` view is exempt — a user always sees
  // their own listings regardless of their own visibility.
  const visibleListings = mine
    ? (listings ?? [])
    : (listings ?? []).filter((l: any) => orgsMap[l.org_id]?.network_visible === true)

  // Batch-fetch line item totals so cards can show aggregate price
  const listingIds = visibleListings.map((l: any) => l.id as string)
  const itemTotalsMap: Record<string, number> = {}
  if (listingIds.length > 0) {
    const { data: lineItems } = await adminClient
      .from('listing_line_items')
      .select('listing_id, quantity, unit_price')
      .in('listing_id', listingIds)
    for (const item of lineItems ?? []) {
      const qty = Number(item.quantity) || 0
      const price = Number(item.unit_price) || 0
      if (qty > 0 && price > 0) {
        itemTotalsMap[item.listing_id] = (itemTotalsMap[item.listing_id] ?? 0) + qty * price
      }
    }
  }

  const result = visibleListings.map((listing: any) => ({
    listing,
    poster_org: orgsMap[listing.org_id] ?? null,
    poster_passport_narrative: null,
    line_items_total: itemTotalsMap[listing.id] ?? null,
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

  // Feature gate (TD.4): platform unlocks on Passport SUBMISSION, not approval.
  // A network-visible org (network_visible=true is set on submission) may post —
  // we no longer require status==='active' (which only happens after AI approval).
  const { data: org } = await adminClient
    .from('organizations')
    .select('status, kyb_status, network_visible')
    .eq('id', me.org_id)
    .single()

  if (!org || !org.network_visible || org.kyb_status === 'not_started') {
    return NextResponse.json({ error: 'Activate your Passport to post listings' }, { status: 403 })
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

  const bodyWithVisibility = body as CreateListingPayload & {
    status?: string
    visibility?: string
    network_id?: string
  }
  const visibility = bodyWithVisibility.visibility ?? 'public'
  const listingNetworkId = bodyWithVisibility.network_id ?? null

  if (visibility === 'network_only' && !listingNetworkId) {
    return NextResponse.json({ error: 'network_id is required when visibility is network_only' }, { status: 400 })
  }

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
      visibility: isDraft ? 'public' : visibility,
      network_id: listingNetworkId,
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

    // G9.6 — notify active network members of a new network_only listing
    if (visibility === 'network_only' && listingNetworkId) {
      try {
        const { data: anchorOrg } = await adminClient
          .from('organizations')
          .select('legal_name')
          .eq('id', me.org_id)
          .single()

        const { data: activeMembers } = await adminClient
          .from('anchor_network_members')
          .select('supplier_org_id')
          .eq('network_id', listingNetworkId)
          .eq('status', 'active')

        const { data: networkRow } = await adminClient
          .from('anchor_networks')
          .select('name')
          .eq('id', listingNetworkId)
          .single()

        if (activeMembers && activeMembers.length > 0) {
          const supplierOrgIds = activeMembers.map((m: { supplier_org_id: string }) => m.supplier_org_id)
          const { data: supplierUsers } = await adminClient
            .from('users')
            .select('id')
            .in('org_id', supplierOrgIds)
            .in('role', ['org_admin', 'org_member'])

          const notifRows = (supplierUsers ?? []).map((u: { id: string }) => ({
            user_id:   u.id,
            event:     'network_listing_posted',
            title:     `${anchorOrg?.legal_name ?? 'A buyer'} posted a new listing in ${networkRow?.name ?? 'your network'}`,
            body:      `New listing: ${listing.title}`,
            deep_link: `/marketplace/listings/${listing.id}`,
            read:      false,
          }))

          if (notifRows.length > 0) {
            await adminClient.from('notifications').insert(notifRows)
          }
        }
      } catch { /* non-fatal */ }
    }
  }

  return NextResponse.json({ listing }, { status: 201 })
}
