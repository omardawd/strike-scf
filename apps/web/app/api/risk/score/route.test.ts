// Regression test for ASSESSMENT.md P0-1: a bank_admin/bank_credit_officer
// must only be able to score organizations belonging to their OWN bank.
// This is the highest-priority test named in AUTHORIZATION_MATRIX.md's
// negative-test list — it directly exercises the cross-tenant write bug
// that was found and fixed in this engagement (and the follow-up bug,
// P0-6, where the first fix used a column name — `bank_id` — that doesn't
// exist on `organizations`, which would have made this route always deny
// legitimate same-bank access).
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
    auth: {
      getUser: async () => ({ data: { user: state.currentUser } }),
    },
  }),
}))

function postRequest(body: unknown): Request {
  return new Request('https://example.com/api/risk/score', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
})

describe('POST /api/risk/score — cross-tenant isolation (P0-1 regression)', () => {
  it('denies a bank_admin scoring an org belonging to a DIFFERENT bank', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'bank-user-1' }
    state.tables.users = { data: { role: 'bank_admin', bank_id: 'bank-A', org_id: null } }
    state.tables.organizations = { data: { id: 'org-1', primary_bank_id: 'bank-B', kyb_status: 'approved' } }

    const res = await POST(postRequest({ org_id: 'org-1' }))
    expect(res.status).toBe(403)
  })

  it('allows a bank_admin scoring an org belonging to THEIR OWN bank', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'bank-user-1' }
    state.tables.users = { data: { role: 'bank_admin', bank_id: 'bank-A', org_id: null } }
    state.tables.organizations = {
      data: {
        id: 'org-1',
        primary_bank_id: 'bank-A',
        kyb_status: 'approved',
        sourcing_countries: [],
        country_of_origin: null,
      },
    }
    state.tables.market_signals = { data: null }
    state.tables.transactions = { data: [] }
    state.tables.credit_scores = { data: null }

    const res = await POST(postRequest({ org_id: 'org-1' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.org_id).toBe('org-1')
    expect(typeof json.risk_score).toBe('number')
  })

  it('denies a supplier org_admin scoring an org that is not their own', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'org-user-1' }
    state.tables.users = { data: { role: 'org_admin', bank_id: null, org_id: 'org-mine' } }

    const res = await POST(postRequest({ org_id: 'org-not-mine' }))
    expect(res.status).toBe(403)
  })

  it('rejects unauthenticated requests', async () => {
    const { POST } = await import('./route')

    state.currentUser = null
    const res = await POST(postRequest({ org_id: 'org-1' }))
    expect(res.status).toBe(401)
  })
})
