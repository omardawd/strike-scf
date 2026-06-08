import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminClient = createAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ALLOWED_PATCH_FIELDS = ['title', 'description', 'target_price', 'expires_at', 'status'] as const
const ALLOWED_STATUS_VALUES = ['closed', 'cancelled']

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('id, role, org_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  const { data: listing, error } = await adminClient
    .from('marketplace_listings')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !listing) {
    return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
  }

  // Increment view_count (fire-and-forget, non-atomic — matches codebase pattern)
  adminClient
    .from('marketplace_listings')
    .update({ view_count: (listing.view_count ?? 0) + 1 })
    .eq('id', id)
    .then(() => {})

  const { data: poster_org } = await adminClient
    .from('organizations')
    .select('id, legal_name, doing_business_as, type, passport_score, risk_tier, trade_count_total, trade_volume_total, avg_payment_days, dispute_rate_network, country_of_origin, description')
    .eq('id', listing.org_id)
    .single()

  const isListingOwner = me.org_id != null && me.org_id === listing.org_id

  // Listing owner sees all offers; others see only their own
  const offersQuery = adminClient
    .from('marketplace_offers')
    .select('*')
    .eq('listing_id', id)
    .order('offered_price', { ascending: false })

  const { data: rawOffers } = isListingOwner
    ? await offersQuery
    : me.org_id
      ? await offersQuery.eq('from_org_id', me.org_id)
      : await offersQuery.eq('from_org_id', '')

  const offerCount = isListingOwner ? (rawOffers ?? []).length : null

  // Batch-fetch offeror orgs
  const offerorOrgIds = [...new Set((rawOffers ?? []).map((o: any) => o.from_org_id as string))]
  const offerorOrgsMap: Record<string, any> = {}

  if (offerorOrgIds.length > 0) {
    const { data: offerorOrgs } = await adminClient
      .from('organizations')
      .select('id, legal_name, doing_business_as, type, passport_score, risk_tier, trade_count_total, avg_payment_days, dispute_rate_network')
      .in('id', offerorOrgIds)
    for (const org of offerorOrgs ?? []) {
      offerorOrgsMap[org.id] = org
    }
  }

  const offers = (rawOffers ?? []).map((offer: any) => ({
    offer,
    offeror_org: offerorOrgsMap[offer.from_org_id] ?? null,
    ai_analysis: offer.ai_analysis ?? null,
    ai_recommendation: offer.ai_recommendation ?? null,
  }))

  return NextResponse.json({ listing, poster_org: poster_org ?? null, offers, offer_count: offerCount, viewer_org_id: me.org_id ?? null })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: me } = await adminClient
    .from('users')
    .select('role, org_id')
    .eq('id', user.id)
    .single()
  if (!me) return NextResponse.json({ error: 'User not found' }, { status: 401 })

  if (!me.org_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: listing } = await adminClient
    .from('marketplace_listings')
    .select('id, org_id')
    .eq('id', id)
    .single()

  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })
  if (listing.org_id !== me.org_id) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  for (const field of ALLOWED_PATCH_FIELDS) {
    if (field in body) {
      if (field === 'status') {
        if (!ALLOWED_STATUS_VALUES.includes(body[field] as string)) {
          return NextResponse.json(
            { error: `Status must be one of: ${ALLOWED_STATUS_VALUES.join(', ')}` },
            { status: 400 }
          )
        }
      }
      update[field] = body[field]
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { data: updated, error: updateError } = await adminClient
    .from('marketplace_listings')
    .update(update)
    .eq('id', id)
    .select()
    .single()

  if (updateError) {
    console.error('Listing PATCH error:', updateError)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ listing: updated })
}
