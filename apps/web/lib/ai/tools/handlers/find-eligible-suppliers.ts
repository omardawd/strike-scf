import { adminClient } from '../admin'
import { isOrgAdmitted } from '@/lib/auth/admission'

export type ToolActor = { userId: string; orgId: string | null; bankId: string | null }

export interface FindEligibleSuppliersInput {
  listing_id: string
}

/**
 * Scoped strictly to ONE listing's own visibility rule — never a general
 * supplier-directory enumeration. A network_only listing only ever returns
 * that network's active members; a public listing returns the same
 * admitted + network_visible pool the marketplace browse page already
 * exposes (lib/networks/visibility.ts's underlying rule), nothing broader.
 * Only the listing owner may call this for their own listing.
 */
export async function findEligibleSuppliers(input: FindEligibleSuppliersInput, actor?: ToolActor) {
  if (!actor?.orgId) return { error: 'An authenticated organization user is required' }

  const { data: listing } = await adminClient
    .from('marketplace_listings')
    .select('id, org_id, listing_type, visibility, network_id, min_passport_score')
    .eq('id', input.listing_id)
    .single()
  if (!listing) return { error: 'Listing not found' }
  if (listing.org_id !== actor.orgId) return { error: 'Forbidden — only the listing owner can look up eligible suppliers' }

  const orgSelect = 'id, legal_name, doing_business_as, status, kyb_status, network_visible, passport_score, risk_tier, performance_tier'

  let candidates: Array<{
    id: string; legal_name: string | null; doing_business_as: string | null
    status: string; kyb_status: string; network_visible: boolean
    passport_score: number | null; risk_tier: string | null; performance_tier: string | null
  }> = []

  if (listing.visibility === 'network_only' && listing.network_id) {
    const { data: members } = await adminClient
      .from('anchor_network_members')
      .select('supplier_org_id')
      .eq('network_id', listing.network_id)
      .eq('status', 'active')
    const memberIds = (members ?? []).map((m: { supplier_org_id: string }) => m.supplier_org_id)
    if (memberIds.length === 0) return { listing_id: input.listing_id, eligible_suppliers: [], message: 'No active network members yet.' }

    const { data: orgs } = await adminClient.from('organizations').select(orgSelect).in('id', memberIds)
    candidates = orgs ?? []
  } else {
    // Public listing — the same admitted + network_visible pool the
    // marketplace browse page already surfaces to this org, bounded so this
    // never becomes an unbounded directory scan.
    const { data: orgs } = await adminClient
      .from('organizations')
      .select(orgSelect)
      .eq('network_visible', true)
      .eq('status', 'active')
      .eq('kyb_status', 'approved')
      .neq('id', actor.orgId)
      .limit(50)
    candidates = orgs ?? []
  }

  const eligible = candidates
    .filter(org => isOrgAdmitted(org))
    .filter(org => listing.min_passport_score == null || (org.passport_score ?? 0) >= listing.min_passport_score)
    .map(org => ({
      org_id: org.id,
      name: org.doing_business_as || org.legal_name || org.id,
      passport_score: org.passport_score,
      risk_tier: org.risk_tier,
      performance_tier: org.performance_tier,
    }))

  return {
    listing_id: input.listing_id,
    visibility: listing.visibility,
    eligible_supplier_count: eligible.length,
    eligible_suppliers: eligible,
  }
}
