// Regression tests for closure item 3: proposing/accepting an amendment
// expands the deal (optional) and requires admission; rejecting one declines
// and stays allowed regardless of admission status.
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

vi.mock('@/lib/email', () => ({
  sendEmail: async () => {},
  dealAmendmentProposedEmailHtml: () => '',
  dealAmendmentRespondedEmailHtml: () => '',
}))

const baseDeal = {
  id: 'deal-1', status: 'confirmed', buyer_org_id: 'buyer-org', supplier_org_id: 'supplier-org',
  financing_payment_active: false, amendment_history: [],
  agreed_quantity: 10, agreed_price: 1000, agreed_delivery_date: null, agreed_payment_terms: null, import_notes: null,
}

function postRequest(body: unknown): Request {
  return new Request('https://example.com/api/deals/deal-1/amendment', { method: 'POST', body: JSON.stringify(body) })
}
function patchRequest(body: unknown): Request {
  return new Request('https://example.com/api/deals/deal-1/amendment', { method: 'PATCH', body: JSON.stringify(body) })
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
})

describe('POST /api/deals/[id]/amendment — proposing (closure item 3)', () => {
  it('denies a non-admitted (suspended) party from proposing an amendment', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'buyer-org' } }
    state.tables.deals = { data: baseDeal }
    state.tables.organizations = { data: { status: 'suspended', kyb_status: 'approved' } }

    const res = await POST(postRequest({ field: 'agreed_price', proposed_value: 2000, reason: 'market shift' }), { params: Promise.resolve({ id: 'deal-1' }) })
    expect(res.status).toBe(403)
  })

  it('allows an admitted party to propose an amendment', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'buyer-org' } }
    state.tables.deals = { data: baseDeal }
    state.tables.organizations = { data: { status: 'active', kyb_status: 'approved', primary_contact_email: null, legal_name: 'Buyer' } }

    const res = await POST(postRequest({ field: 'agreed_price', proposed_value: 2000, reason: 'market shift' }), { params: Promise.resolve({ id: 'deal-1' }) })
    expect(res.status).toBe(200)
  })
})

describe('PATCH /api/deals/[id]/amendment — responding (closure item 3)', () => {
  const dealWithPendingAmendment = {
    ...baseDeal,
    amendment_history: [{
      id: 'amend-1', proposed_by: 'other-user', proposed_at: '2026-01-01', field: 'agreed_price',
      current_value: 1000, proposed_value: 2000, reason: 'market shift', status: 'pending', responded_at: null, response: null,
    }],
  }

  it('denies a non-admitted party from ACCEPTING an amendment', async () => {
    const { PATCH } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'supplier-org' } }
    state.tables.deals = { data: dealWithPendingAmendment }
    state.tables.organizations = { data: { status: 'suspended', kyb_status: 'approved' } }

    const res = await PATCH(patchRequest({ amendment_id: 'amend-1', response: 'accepted' }), { params: Promise.resolve({ id: 'deal-1' }) })
    expect(res.status).toBe(403)
  })

  it('allows a non-admitted party to REJECT an amendment (declining is always allowed)', async () => {
    const { PATCH } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'supplier-org' } }
    state.tables.deals = { data: dealWithPendingAmendment }
    // No 'organizations' stub — if reject were wrongly admission-gated this
    // would 403 by default (isOrgAdmitted(null) === false).
    state.tables.organizations = { data: null }

    const res = await PATCH(patchRequest({ amendment_id: 'amend-1', response: 'rejected' }), { params: Promise.resolve({ id: 'deal-1' }) })
    expect(res.status).toBe(200)
  })
})
