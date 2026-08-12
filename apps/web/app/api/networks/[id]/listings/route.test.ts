// Route-level regression test for closure item 2: GET /api/networks/[id]/listings
// must deny a requester whose org has been suspended since joining/creating
// the network.
import { describe, expect, it, beforeEach, vi } from 'vitest'

interface MockUser { id: string }
interface TableResponse { data: unknown; error?: unknown }

const state: {
  currentUser: MockUser | null
  tables: Record<string, TableResponse>
} = { currentUser: null, tables: {} }

function createChain(response: TableResponse) {
  const chain: Record<string, unknown> = {}
  const chainMethods = ['select', 'eq', 'order', 'limit', 'not', 'in', 'contains', 'update', 'insert', 'delete', 'single', 'maybeSingle']
  for (const method of chainMethods) {
    chain[method] = () => chain
  }
  ;(chain as { then: unknown }).then = (
    resolve: (value: TableResponse) => void
  ) => resolve(response)
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

vi.mock('@/lib/networks/listings', () => ({ getNetworkListings: async () => [] }))

const network = {
  id: 'network-1', anchor_org_id: 'owner-org', name: 'Test Network',
  description: null, visibility_default: 'public', member_count: 1,
  created_at: '2026-01-01', updated_at: '2026-01-01',
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
})

describe('GET /api/networks/[id]/listings — admission re-checked (closure item 2)', () => {
  it('denies a member org that has since been suspended', async () => {
    const { GET } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'member-org' } }
    state.tables.anchor_networks = { data: network }
    state.tables.organizations = { data: { status: 'suspended', kyb_status: 'approved' } }
    state.tables.anchor_network_members = { data: { id: 'row-1' } }

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

    const res = await GET(new Request('https://example.com'), { params: Promise.resolve({ id: 'network-1' }) })
    expect(res.status).toBe(200)
  })
})
