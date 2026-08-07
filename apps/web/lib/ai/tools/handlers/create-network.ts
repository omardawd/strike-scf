import { adminClient } from '../admin'

export interface CreateNetworkInput {
  org_id: string
  name: string
  description?: string
  visibility_default?: 'public' | 'network_only'
}

// Mirrors POST /api/networks — kept in sync with that route's validation.
// Any org can own a network (no more anchor-only restriction).
export async function createNetwork(input: CreateNetworkInput) {
  const name = (input.name ?? '').trim()
  if (!name) return { error: 'name is required' }
  if (name.length > 60) return { error: 'name must be 60 characters or fewer' }
  if (input.visibility_default && !['public', 'network_only'].includes(input.visibility_default)) {
    return { error: 'visibility_default must be "public" or "network_only"' }
  }

  const { data: network, error } = await adminClient
    .from('anchor_networks')
    .insert({
      anchor_org_id:      input.org_id,
      name,
      description:        input.description ?? null,
      visibility_default: input.visibility_default ?? 'public',
    })
    .select()
    .single()

  if (error || !network) {
    return { error: `Failed to create network: ${error?.message ?? 'unknown error'}` }
  }

  return {
    network_id: network.id,
    name: network.name,
    visibility_default: network.visibility_default,
    url: `/networks/${network.id}`,
  }
}
