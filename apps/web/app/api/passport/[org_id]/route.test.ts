// Regression tests for PR 1b: viewing ANOTHER org's passport previously
// required only network_visible (Ghost Mode) — a submitted/under_review/
// rejected/suspended org was discoverable via Passport. Own passport must
// always remain viewable (view own KYB status is explicitly permitted).
import { describe, expect, it, beforeEach, vi } from 'vitest'

interface MockUser { id: string }
interface TableResponse { data: unknown; error?: unknown; count?: number }

const state: {
  currentUser: MockUser | null
  tables: Record<string, TableResponse>
} = { currentUser: null, tables: {} }

// organizations is queried both as a single row (.single()/.maybeSingle(),
// e.g. the requester/target org lookup) and as a list (no .single(), e.g.
// the network passport-score-median query) within the same route call.
// Track whether the chain terminated in single-row mode so the same table
// stub can serve both shapes without the test needing two separate tables.
function createChain(response: TableResponse) {
  let isSingle = false
  const chain: Record<string, unknown> = {}
  const chainMethods = ['select', 'eq', 'or', 'not', 'gte', 'order', 'limit', 'in', 'contains', 'update', 'insert', 'delete']
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
    // Non-single call against a stub shaped as a single row — serve it as a
    // one-element list instead of erroring on .map()/.filter() downstream.
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

vi.mock('@/lib/passport/trade-stats', () => ({
  getOrgTradeStats: async () => ({ trade_count_total: 0, trade_volume_total: 0, avg_payment_days: null, on_time_payment_rate: null, dispute_rate_network: null }),
}))

vi.mock('@/lib/networks/visibility', () => ({
  getVisibilityFilter: async () => ({ publicOnly: true, activeNetworkIds: [] }),
  buildListingVisibilityOr: () => 'visibility.eq.public',
}))

function getRequest(): Request {
  return new Request('https://example.com/api/passport/org-2')
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
})

describe('GET /api/passport/[org_id] — admission enforcement (PR 1b)', () => {
  const nonAdmittedCases = [
    { label: 'submitted', status: 'kyb_submitted', kyb_status: 'submitted', network_visible: true },
    { label: 'rejected', status: 'rejected', kyb_status: 'rejected', network_visible: true },
    { label: 'suspended', status: 'suspended', kyb_status: 'approved', network_visible: true },
  ]

  for (const { label, status, kyb_status, network_visible } of nonAdmittedCases) {
    it(`denies viewing a ${label} org's passport from a different org`, async () => {
      const { GET } = await import('./route')

      state.currentUser = { id: 'user-1' }
      state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
      state.tables.organizations = { data: { id: 'org-2', status, kyb_status, network_visible } }

      const res = await GET(getRequest(), { params: Promise.resolve({ org_id: 'org-2' }) })
      expect(res.status).toBe(403)
    })
  }

  it('allows viewing an approved org\'s passport from a different org', async () => {
    const { GET } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
    state.tables.organizations = { data: { id: 'org-2', status: 'active', kyb_status: 'approved', network_visible: true } }
    state.tables.passport_peer_reviews = { data: [] }
    state.tables.supplier_performance = { data: null }
    state.tables.passport_views = { data: [] }
    state.tables.deals = { count: 0, data: null }
    state.tables.marketplace_listings = { data: [] }

    const res = await GET(getRequest(), { params: Promise.resolve({ org_id: 'org-2' }) })
    expect(res.status).toBe(200)
  })

  it('a non-admitted org can always view its OWN passport (view own KYB status is permitted)', async () => {
    const { GET } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-2' } }
    state.tables.organizations = { data: { id: 'org-2', status: 'kyb_submitted', kyb_status: 'submitted', network_visible: true } }
    state.tables.passport_peer_reviews = { data: [] }
    state.tables.supplier_performance = { data: null }
    state.tables.passport_views = { data: [] }
    state.tables.deals = { count: 0, data: null }
    state.tables.marketplace_listings = { data: [] }

    const res = await GET(getRequest(), { params: Promise.resolve({ org_id: 'org-2' }) })
    expect(res.status).toBe(200)
  })
})
