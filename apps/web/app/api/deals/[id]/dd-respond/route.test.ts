// Regression test for closure item 3: accepting a DD offer expands the deal
// and requires admission; declining reduces exposure and stays allowed.
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
    resolve?: (value: TableResponse) => void
  ) => { if (resolve) resolve(response) }
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

vi.mock('@/lib/email', () => ({ sendEmail: async () => {} }))

const baseDeal = {
  id: 'deal-1', status: 'delivery_confirmed', buyer_org_id: 'buyer-org', supplier_org_id: 'supplier-org',
  financing_payment_active: false, total_value: 1000, agreed_price: 1000, agreed_currency: 'USD',
  payment_due_date: '2026-06-01', dd_offer_presented_at: '2026-05-01', dd_offer_accepted_at: null, dd_offer_declined_at: null,
}

const baseTxn = { id: 'txn-1', discount_rate: 2, discount_amount: 10, early_payment_date: '2026-05-15', invoice_amount: 1000 }

function postRequest(body: unknown): Request {
  return new Request('https://example.com/api/deals/deal-1/dd-respond', { method: 'POST', body: JSON.stringify(body) })
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
})

describe('POST /api/deals/[id]/dd-respond — admission enforcement (closure item 3)', () => {
  it('denies a non-admitted (suspended) supplier from ACCEPTING a DD offer', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'supplier-org' } }
    state.tables.deals = { data: baseDeal }
    state.tables.transactions = { data: baseTxn }
    state.tables.organizations = { data: { status: 'suspended', kyb_status: 'approved' } }

    const res = await POST(postRequest({ accepted: true }), { params: Promise.resolve({ id: 'deal-1' }) })
    expect(res.status).toBe(403)
  })

  it('allows a non-admitted supplier to DECLINE a DD offer', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'supplier-org' } }
    state.tables.deals = { data: baseDeal }
    state.tables.transactions = { data: baseTxn }
    // No 'organizations' stub needed/consulted for a decline.

    const res = await POST(postRequest({ accepted: false }), { params: Promise.resolve({ id: 'deal-1' }) })
    expect(res.status).not.toBe(403)
  })
})
