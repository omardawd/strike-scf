// Regression test for closure item 3: accepting a proposed workflow step
// commits to an optional addition and requires admission; declining stays
// allowed regardless of admission status.
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

vi.mock('@/lib/email', () => ({
  sendEmail: async () => {},
  dealWorkflowProposedEmailHtml: () => '',
  dealWorkflowRespondedEmailHtml: () => '',
}))

const baseDeal = { id: 'deal-1', buyer_org_id: 'buyer-org', supplier_org_id: 'supplier-org', status: 'confirmed' }
const proposedStep = { id: 'step-1', status: 'proposed', proposed_by_user_id: 'other-user' }

function patchRequest(body: unknown): Request {
  return new Request('https://example.com/api/deals/deal-1/workflow/step-1', { method: 'PATCH', body: JSON.stringify(body) })
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
})

describe('PATCH /api/deals/[id]/workflow/[stepId] — admission enforcement (closure item 3)', () => {
  it('denies a non-admitted (suspended) supplier from ACCEPTING a workflow step', async () => {
    const { PATCH } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', org_id: 'supplier-org' } }
    state.tables.organizations = { data: { status: 'suspended', kyb_status: 'approved' } }

    const res = await PATCH(patchRequest({ response: 'accepted' }), { params: Promise.resolve({ id: 'deal-1', stepId: 'step-1' }) })
    expect(res.status).toBe(403)
  })

  it('allows a non-admitted supplier to DECLINE a workflow step', async () => {
    const { PATCH } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', org_id: 'supplier-org' } }
    state.tables.deals = { data: baseDeal }
    state.tables.deal_workflow_steps = { data: proposedStep }
    // No 'organizations' stub needed/consulted for a decline.

    const res = await PATCH(patchRequest({ response: 'declined' }), { params: Promise.resolve({ id: 'deal-1', stepId: 'step-1' }) })
    expect(res.status).toBe(200)
  })
})
