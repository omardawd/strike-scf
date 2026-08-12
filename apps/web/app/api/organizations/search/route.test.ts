// Regression tests for org-admission enforcement on org search:
// - PR 1: the TARGET org filter already included status='active'; kyb_status
//   was added for defense in depth (status/kyb_status are set together on
//   approval, but nothing at the DB level enforces they can't drift apart).
// - PR 1b: the REQUESTING org must itself be admitted to search/discover at
//   all — a non-admitted org previously could still search for counterparties.
import { describe, expect, it, beforeEach, vi } from 'vitest'

interface MockUser { id: string }
interface TableResponse { data: unknown; error?: unknown }

const state: {
  currentUser: MockUser | null
  tables: Record<string, TableResponse>
} = { currentUser: null, tables: {} }
const eqCalls: Array<[string, unknown]> = []

// The route queries 'organizations' up to twice (the requester's own org for
// the admission gate, then the actual search query) and 'users' once. The
// requester-gate query only ever calls .eq('id', ...); the search query is
// the only caller of .eq('status', ...) / .eq('kyb_status', ...) /
// .eq('network_visible', ...), so tracking every .eq() call on
// 'organizations' unambiguously captures the search filter regardless of
// call order (which varies depending on whether the requester has an org_id).
function createChain(table: string, response: TableResponse) {
  const chain: Record<string, unknown> = {}
  const passthroughMethods = ['select', 'or', 'limit', 'single', 'maybeSingle']
  for (const method of passthroughMethods) {
    chain[method] = () => chain
  }
  chain.eq = (col: string, val: unknown) => {
    if (table === 'organizations') eqCalls.push([col, val])
    return chain
  }
  ;(chain as { then: unknown }).then = (
    resolve: (value: TableResponse) => void
  ) => resolve(response)
  return chain
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => createChain(table, state.tables[table] ?? { data: null, error: null }),
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.currentUser } }),
    },
  }),
}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: async () => ({ allowed: true, remaining: 30, limit: 30, resetAt: Date.now() }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}))

function getRequest(q: string): Request {
  return new Request(`https://example.com/api/organizations/search?q=${encodeURIComponent(q)}`)
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
  eqCalls.length = 0
})

describe('GET /api/organizations/search', () => {
  it('filters the search query on status=active AND kyb_status=approved (not status alone) for an admitted requester', async () => {
    const { GET } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { org_id: 'org-1' } }
    state.tables.organizations = { data: { status: 'active', kyb_status: 'approved' } }

    const res = await GET(getRequest('acme'))
    expect(res.status).toBe(200)

    expect(eqCalls).toContainEqual(['network_visible', true])
    expect(eqCalls).toContainEqual(['status', 'active'])
    expect(eqCalls).toContainEqual(['kyb_status', 'approved'])
  })

  it('rejects unauthenticated requests', async () => {
    const { GET } = await import('./route')

    state.currentUser = null
    const res = await GET(getRequest('acme'))
    expect(res.status).toBe(401)
  })

  it('returns no results for a non-admitted (submitted) requesting org — the search query never even runs', async () => {
    const { GET } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { org_id: 'org-1' } }
    state.tables.organizations = { data: { status: 'kyb_submitted', kyb_status: 'submitted' } }

    const res = await GET(getRequest('acme'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.organizations).toEqual([])
    // The requester-gate lookup itself calls .eq('id', ...), but the search
    // query's own filter never ran — that's the property under test.
    expect(eqCalls).not.toContainEqual(['status', 'active'])
  })

  it('does not gate a bank user (no org_id) at all', async () => {
    const { GET } = await import('./route')

    state.currentUser = { id: 'bank-user-1' }
    state.tables.users = { data: { org_id: null } }

    const res = await GET(getRequest('acme'))
    expect(res.status).toBe(200)
    expect(eqCalls).toContainEqual(['status', 'active'])
  })
})
