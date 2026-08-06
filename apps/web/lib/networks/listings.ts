import { SupabaseClient } from '@supabase/supabase-js'

export interface NetworkListing {
  id: string
  title: string
  listing_type: string
  target_price: number | null
  currency: string | null
  status: string
  created_at: string
  org_id: string
  poster_name: string | null
}

/**
 * Recent active listings scoped to a single network — one implementation
 * shared by the network detail page's "Recent Listings" section and the
 * Strike Place network filter, so both surfaces agree on what "this
 * network's listings" means.
 */
export async function getNetworkListings(
  supabaseAdmin: SupabaseClient,
  networkId: string,
  limit = 10
): Promise<NetworkListing[]> {
  const { data: listings } = await supabaseAdmin
    .from('marketplace_listings')
    .select('id, title, listing_type, target_price, currency, status, created_at, org_id')
    .eq('network_id', networkId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(limit)

  const rows = listings ?? []
  const orgIds = [...new Set(rows.map(r => r.org_id))]
  const orgNameMap: Record<string, string> = {}
  if (orgIds.length > 0) {
    const { data: orgs } = await supabaseAdmin
      .from('organizations')
      .select('id, legal_name')
      .in('id', orgIds)
    for (const o of orgs ?? []) orgNameMap[o.id] = o.legal_name
  }

  return rows.map(r => ({ ...r, poster_name: orgNameMap[r.org_id] ?? null }))
}
