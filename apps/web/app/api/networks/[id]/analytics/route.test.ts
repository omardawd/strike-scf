// Route-level regression test for closure item 2: GET /api/networks/[id]/analytics
// must deny a requester whose org has been suspended since joining/creating
// the network, even though getNetworkAccess() (unit-tested in
// lib/networks/access.test.ts) is the actual source of the gate.
import { describe, expect, it, beforeEach, vi } from 'vitest'

interface MockUser { id: string }
interface TableResponse { data: unknown; error?: unknown; count?: number }

const state: {
  currentUser: MockUser | null
  tables: Record<string, TableResponse>
} = { currentUser: null, tables: {} }

// Several tables here are queried both as a single row (.single()/
// .maybeSingle(), e.g. anchor_network_members inside getNetworkAccess) and
// as a list (no .single(), e.g. the full member roster) within the same GET
// call — auto-detect which mode terminated the chain so one stub can serve
// both shapes.
function createChain(response: TableResponse) {
  let isSingle = false
  const chain: Record<string, unknown> = {}
  const chainMethods = ['select', 'eq', 'or', 'neq', 'in', 'order', 'limit', 'not', 'contains', 'update', 'insert', 'delete']
  for (const method of chainMethods) {
    chain[method] = () => chain
  }
  chain.single = () => { isSingle = true; return chain }
  chain.maybeSingle = () => { isSingle = true; return chain }
  ;(chain as { then: unknown }).then = (
    resolve: (value: TableResponse) => void
  ) => {
    if (isSingle || response.data == null || Array.isArray(response.data)) {
      return resolve(response)
    }
    return resolve({ ...response, data: [response.data] })
  }
  return chain
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => createChain(state.tables[table] ?? { data: null, error: null }),
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.currentUser } }) },
  }),
}))

const network = {
  id: 'network-1', anchor_org_id: 'owner-org', name: 'Test Network',
  description: null, visibility_default: 'public', member_count: 1,
  created_at: '2026-01-01', updated_at: '2026-01-01',
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
})

describe('GET /api/networks/[id]/analytics — admission re-checked (closure item 2)', () => {
  it('denies an owner org that has since been suspended', async () => {
    const { GET } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'owner-org' } }
    state.tables.anchor_networks = { data: network }
    state.tables.organizations = { data: { status: 'suspended', kyb_status: 'approved' } }

    const res = await GET(new Request('https://example.com'), { params: Promise.resolve({ id: 'network-1' }) })
    expect(res.status).toBe(403)
  })

  it('denies an active member whose org has since been suspended', async () => {
    const { GET } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'member-org' } }
    state.tables.anchor_networks = { data: network }
    state.tables.organizations = { data: { status: 'suspended', kyb_status: 'approved' } }
    state.tables.anchor_network_members = { data: { id: 'row-1' } }

    const res = await GET(new Request('https://example.com'), { params: Promise.resolve({ id: 'network-1' }) })
    expect(res.status).toBe(403)
  })

  it('denies an unrelated (non-member) org even if admitted', async () => {
    const { GET } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'unrelated-org' } }
    state.tables.anchor_networks = { data: network }
    state.tables.organizations = { data: { status: 'active', kyb_status: 'approved' } }
    state.tables.anchor_network_members = { data: null }

    const res = await GET(new Request('https://example.com'), { params: Promise.resolve({ id: 'network-1' }) })
    expect(res.status).toBe(403)
  })

  it('allows an admitted, active member', async () => {
    const { GET } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'member-org' } }
    state.tables.anchor_networks = { data: network }
    state.tables.organizations = { data: { status: 'active', kyb_status: 'approved' } }
    state.tables.anchor_network_members = { data: { id: 'row-1' } }
    state.tables.marketplace_listings = { data: [], count: 0 }
    state.tables.deals = { data: [] }

    const res = await GET(new Request('https://example.com'), { params: Promise.resolve({ id: 'network-1' }) })
    expect(res.status).toBe(200)
  })
})
