import { SupabaseClient } from '@supabase/supabase-js'

export interface VisibilityFilter {
  publicOnly: boolean
  activeNetworkIds: string[]
}

/**
 * Returns the network memberships for requestingOrgId.
 * Always call this before returning any listing or financing request data to a client.
 */
export async function getVisibilityFilter(
  supabaseAdmin: SupabaseClient,
  requestingOrgId: string
): Promise<VisibilityFilter> {
  const { data: memberships } = await supabaseAdmin
    .from('anchor_network_members')
    .select('network_id')
    .eq('supplier_org_id', requestingOrgId)
    .eq('status', 'active')

  return {
    publicOnly: !memberships || memberships.length === 0,
    activeNetworkIds: memberships?.map((m: { network_id: string }) => m.network_id) ?? [],
  }
}

/**
 * Builds the .or() filter string for a marketplace_listings query.
 * The caller must append this to the Supabase query builder.
 * Uses `org_id` — the actual column name on marketplace_listings.
 */
export function buildListingVisibilityOr(
  filter: VisibilityFilter,
  requestingOrgId: string
): string {
  if (filter.publicOnly) {
    return `visibility.eq.public,org_id.eq.${requestingOrgId}`
  }
  const networkIds = filter.activeNetworkIds.join(',')
  return `visibility.eq.public,org_id.eq.${requestingOrgId},and(visibility.eq.network_only,network_id.in.(${networkIds}))`
}

/**
 * Checks whether a single listing is visible to the requesting org.
 * Returns false if the listing is network_only and the org is not a member.
 * `listing.org_id` is the poster's org (marketplace_listings.org_id).
 */
export async function isListingVisibleToOrg(
  supabaseAdmin: SupabaseClient,
  listing: { visibility: string; network_id: string | null; org_id: string },
  requestingOrgId: string
): Promise<boolean> {
  if (listing.visibility === 'public') return true
  if (listing.org_id === requestingOrgId) return true
  if (!listing.network_id) return false

  const { data } = await supabaseAdmin
    .from('anchor_network_members')
    .select('id')
    .eq('network_id', listing.network_id)
    .eq('supplier_org_id', requestingOrgId)
    .eq('status', 'active')
    .maybeSingle()

  return !!data
}
