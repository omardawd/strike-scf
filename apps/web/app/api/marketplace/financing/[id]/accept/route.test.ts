// Regression test for PR 1b: accepting a bank's financing offer had NO
// admission check at all — a submitted/rejected/suspended org could accept.
import { describe, expect, it, beforeEach, vi } from 'vitest'

interface MockUser { id: string }
interface TableResponse { data: unknown; error?: unknown }

const state: {
  currentUser: MockUser | null
  tables: Record<string, TableResponse>
} = { currentUser: null, tables: {} }

function createChain(response: TableResponse) {
  const chain: Record<string, unknown> = {}
  const chainMethods = ['select', 'eq', 'neq', 'order', 'limit', 'not', 'in', 'contains', 'update', 'insert', 'delete', 'single', 'maybeSingle']
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

function patchRequest(body: unknown): Request {
  return new Request('https://example.com/api/marketplace/financing/req-1/accept', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
})

describe('PATCH /api/marketplace/financing/[id]/accept — admission enforcement (PR 1b)', () => {
  const nonAdmittedCases = [
    { label: 'submitted', status: 'kyb_submitted', kyb_status: 'submitted' },
    { label: 'rejected', status: 'rejected', kyb_status: 'rejected' },
    { label: 'suspended', status: 'suspended', kyb_status: 'approved' },
  ]

  for (const { label, status, kyb_status } of nonAdmittedCases) {
    it(`denies a ${label} organization`, async () => {
      const { PATCH } = await import('./route')

      state.currentUser = { id: 'user-1' }
      state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
      state.tables.organizations = { data: { status, kyb_status } }

      const res = await PATCH(patchRequest({ offer_id: 'offer-1' }), { params: Promise.resolve({ id: 'req-1' }) })
      expect(res.status).toBe(403)
    })
  }

  it('does not deny an approved organization at the admission gate', async () => {
    const { PATCH } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
    state.tables.organizations = { data: { status: 'active', kyb_status: 'approved' } }
    state.tables.financing_requests = { data: null }

    const res = await PATCH(patchRequest({ offer_id: 'offer-1' }), { params: Promise.resolve({ id: 'req-1' }) })
    // Falls through to "Financing request not found" (404), never the admission 403.
    expect(res.status).not.toBe(403)
  })
})
