import { adminClient } from '../admin'
import { getVisibilityFilter, buildListingVisibilityOr } from '@/lib/networks/visibility'

export interface SearchMarketplaceListingsInput {
  query: string
  org_id?: string
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
    .order('created_at', { ascending: false })
    .limit(limit)

  // Without an org_id we can only safely show public listings. With one,
  // include network_only listings this org is actually entitled to see —
  // otherwise an agent proposing plans for an org can never discover
  // network-scoped opportunities it legitimately has access to.
  if (input.org_id) {
    const filter = await getVisibilityFilter(adminClient, input.org_id)
    q = q.or(buildListingVisibilityOr(filter, input.org_id))
    // Exclude the caller's own listings — this searches for opportunities to
    // bid/offer on, not a directory of the org's own postings.
    q = q.neq('org_id', input.org_id)
  } else {
    q = q.eq('visibility', 'public')
  }

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

  // Client-side keyword filter on title + description + category.
  // query is required by the tool schema, but agent-scan's freeform JSON
  // proposals aren't schema-validated before being stored, so a proposal
  // can still reach here without one — fall back to "all" rather than crash.
  // Tokenize into individual words and match if ANY word appears in any
  // searchable field (title/description/category/line items/poster org name).
  // Previously this checked the whole query as one contiguous substring —
  // "Walmart steel" would never match a listing titled "505 MT Steel
  // Products" because "Walmart" only ever appears via the org relation, not
  // in the listing's own text, so a completely valid, visible listing was
  // silently filtered out. Confirmed live: this is exactly the natural
  // "org name + product" phrasing a user or the AI itself would ask for.
  const rawKeyword = (input.query || 'all').toLowerCase().trim()
  const words = rawKeyword.split(/\s+/).filter((w) => w.length > 2)
  const filtered = (listings ?? []).filter((l: any) => {
    if (rawKeyword === 'all' || rawKeyword === '' || words.length === 0) return true
    const orgName = (l.organizations?.doing_business_as || l.organizations?.legal_name || '').toLowerCase()
    const haystacks = [
      l.title?.toLowerCase() ?? '',
      l.description?.toLowerCase() ?? '',
      l.category?.toLowerCase() ?? '',
      orgName,
      ...(l.listing_line_items?.map((li: any) => li.name?.toLowerCase() ?? '') ?? []),
    ]
    return words.some((w) => haystacks.some((h) => h.includes(w)))
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
