import { SupabaseClient } from '@supabase/supabase-js'
import { isOrgAdmitted } from '@/lib/auth/admission'

export interface NetworkRow {
  id: string
  anchor_org_id: string
  name: string
  description: string | null
  visibility_default: string
  member_count: number
  created_at: string
  updated_at: string
}

export interface NetworkAccess {
  network: NetworkRow | null
  isOwner: boolean
  hasAccess: boolean
}

/**
 * Single access check reused by every /api/networks/[id]/* route that needs
 * "owner or active member" gating — any active member can view a network's
 * roster, analytics, listings, and room; only the owner can manage it
 * (invite/edit/delete — checked separately by each route via `isOwner`).
 */
export async function getNetworkAccess(
  supabaseAdmin: SupabaseClient,
  networkId: string,
  orgId: string | null
): Promise<NetworkAccess> {
  const { data: network } = await supabaseAdmin
    .from('anchor_networks')
    .select('*')
    .eq('id', networkId)
    .single()

  if (!network || !orgId) return { network: network ?? null, isOwner: false, hasAccess: false }

  const isOwner = network.anchor_org_id === orgId

  // Admission is re-checked on every access, not just at join/create time —
  // an org that was admitted when it joined (or created) this network but
  // has since been suspended/rejected must lose room/listings/analytics
  // access, not retain it indefinitely off a membership row that's now stale.
  const { data: requesterOrg } = await supabaseAdmin
    .from('organizations')
    .select('status, kyb_status')
    .eq('id', orgId)
    .single()
  if (!isOrgAdmitted(requesterOrg)) {
    return { network, isOwner, hasAccess: false }
  }

  if (isOwner) return { network, isOwner: true, hasAccess: true }

  const { data: membership } = await supabaseAdmin
    .from('anchor_network_members')
    .select('id')
    .eq('network_id', networkId)
    .eq('supplier_org_id', orgId)
    .eq('status', 'active')
    .maybeSingle()

  return { network, isOwner: false, hasAccess: !!membership }
}
