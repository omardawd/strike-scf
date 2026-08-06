import { SupabaseClient } from '@supabase/supabase-js'

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
