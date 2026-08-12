// Regression tests for closure item 2: an org that was admitted when it
// joined (or created) a network but has since been suspended/rejected must
// lose room/listings/analytics access on every subsequent request — access
// is re-checked live, not trusted off a membership row set at join time.
import { describe, expect, it } from 'vitest'
import { getNetworkAccess } from './access'

interface TableResponse { data: unknown; error?: unknown }

function createChain(response: TableResponse) {
  const chain: Record<string, unknown> = {}
  const chainMethods = ['select', 'eq', 'single', 'maybeSingle']
  for (const method of chainMethods) {
    chain[method] = () => chain
  }
  ;(chain as { then: unknown }).then = (
    resolve: (value: TableResponse) => void
  ) => resolve(response)
  return chain
}

function mockSupabase(tables: Record<string, TableResponse>) {
  return {
    from: (table: string) => createChain(tables[table] ?? { data: null, error: null }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const network = {
  id: 'network-1',
  anchor_org_id: 'owner-org',
  name: 'Test Network',
  description: null,
  visibility_default: 'public',
  member_count: 1,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
}

describe('getNetworkAccess() — admission re-checked live (closure item 2)', () => {
  it('grants the OWNER access when the owner org is admitted', async () => {
    const supabase = mockSupabase({
      anchor_networks: { data: network },
      organizations: { data: { status: 'active', kyb_status: 'approved' } },
    })
    const result = await getNetworkAccess(supabase, 'network-1', 'owner-org')
    expect(result.isOwner).toBe(true)
    expect(result.hasAccess).toBe(true)
  })

  it('denies the OWNER access when the owner org has since been suspended', async () => {
    const supabase = mockSupabase({
      anchor_networks: { data: network },
      organizations: { data: { status: 'suspended', kyb_status: 'approved' } },
    })
    const result = await getNetworkAccess(supabase, 'network-1', 'owner-org')
    // isOwner is still reported accurately (it's a fact), but access is denied.
    expect(result.isOwner).toBe(true)
    expect(result.hasAccess).toBe(false)
  })

  it('grants an ACTIVE MEMBER access when that member org is admitted', async () => {
    const supabase = mockSupabase({
      anchor_networks: { data: network },
      organizations: { data: { status: 'active', kyb_status: 'approved' } },
      anchor_network_members: { data: { id: 'member-row-1' } },
    })
    const result = await getNetworkAccess(supabase, 'network-1', 'member-org')
    expect(result.isOwner).toBe(false)
    expect(result.hasAccess).toBe(true)
  })

  it('denies an ACTIVE MEMBER access when that member org has since been suspended, even though the membership row itself is still "active"', async () => {
    const supabase = mockSupabase({
      anchor_networks: { data: network },
      organizations: { data: { status: 'suspended', kyb_status: 'approved' } },
      // Membership status is still 'active' — the point of this test is that
      // a stale-but-active membership row must not grant access on its own.
      anchor_network_members: { data: { id: 'member-row-1' } },
    })
    const result = await getNetworkAccess(supabase, 'network-1', 'member-org')
    expect(result.hasAccess).toBe(false)
  })

  it('denies a suspended requester even for a submitted (never-approved) org', async () => {
    const supabase = mockSupabase({
      anchor_networks: { data: network },
      organizations: { data: { status: 'kyb_submitted', kyb_status: 'submitted' } },
      anchor_network_members: { data: { id: 'member-row-1' } },
    })
    const result = await getNetworkAccess(supabase, 'network-1', 'member-org')
    expect(result.hasAccess).toBe(false)
  })

  it('denies an UNRELATED org (admitted, but no membership at all)', async () => {
    const supabase = mockSupabase({
      anchor_networks: { data: network },
      organizations: { data: { status: 'active', kyb_status: 'approved' } },
      anchor_network_members: { data: null },
    })
    const result = await getNetworkAccess(supabase, 'network-1', 'unrelated-org')
    expect(result.isOwner).toBe(false)
    expect(result.hasAccess).toBe(false)
  })

  it('denies access when there is no org id at all (bank/admin caller)', async () => {
    const supabase = mockSupabase({ anchor_networks: { data: network } })
    const result = await getNetworkAccess(supabase, 'network-1', null)
    expect(result.hasAccess).toBe(false)
  })
})
