import { adminClient } from '../admin'

export interface SearchMarketplaceListingsInput {
  query: string
  listing_type?: 'po_request' | 'product_service' | 'all'
  category?: string
  max_budget?: number
  currency?: string
  delivery_location?: string
  limit?: number
}

export async function searchMarketplaceListings(input: SearchMarketplaceListingsInput) {
  const limit = input.limit ?? 10
  const listingType = input.listing_type ?? 'all'

  let q = adminClient
    .from('marketplace_listings')
    .select(`
      id, listing_type, title, description, category, currency,
      target_price, delivery_deadline, delivery_location, incoterms,
      payment_terms, status, visibility, offer_count, view_count,
      created_at, org_id,
      organizations!marketplace_listings_org_id_fkey(
        id, legal_name, doing_business_as, passport_score, kyb_status, country_of_origin
      ),
      listing_line_items(name, quantity, unit, unit_price)
    `)
    .eq('status', 'active')
    .eq('visibility', 'public')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (listingType !== 'all') {
    q = q.eq('listing_type', listingType)
  }

  if (input.category) {
    q = q.ilike('category', `%${input.category}%`)
  }

  if (input.max_budget) {
    q = q.lte('target_price', input.max_budget)
  }

  if (input.delivery_location) {
    q = q.ilike('delivery_location', `%${input.delivery_location}%`)
  }

  const { data: listings, error } = await q

  if (error) {
    return { error: `Search failed: ${error.message}` }
  }

  // Client-side keyword filter on title + description + category
  const keyword = input.query.toLowerCase()
  const filtered = (listings ?? []).filter((l: any) => {
    if (keyword === 'all' || keyword === '') return true
    return (
      l.title?.toLowerCase().includes(keyword) ||
      l.description?.toLowerCase().includes(keyword) ||
      l.category?.toLowerCase().includes(keyword) ||
      l.listing_line_items?.some((li: any) => li.name?.toLowerCase().includes(keyword))
    )
  })

  const results = filtered.map((l: any) => ({
    id: l.id,
    listing_type: l.listing_type,
    title: l.title,
    description: l.description,
    category: l.category,
    org: {
      id: l.organizations?.id,
      name: l.organizations?.doing_business_as || l.organizations?.legal_name,
      passport_score: l.organizations?.passport_score,
      kyb_status: l.organizations?.kyb_status,
      country: l.organizations?.country_of_origin,
    },
    target_price: l.target_price,
    currency: l.currency,
    delivery_deadline: l.delivery_deadline,
    delivery_location: l.delivery_location,
    incoterms: l.incoterms,
    payment_terms: l.payment_terms,
    offer_count: l.offer_count,
    line_items: l.listing_line_items ?? [],
    url: `/marketplace/listings/${l.id}`,
    created_at: l.created_at,
  }))

  return {
    query: input.query,
    listing_type_filter: listingType,
    total_found: results.length,
    listings: results,
  }
}
