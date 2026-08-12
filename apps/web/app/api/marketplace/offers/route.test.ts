// Regression tests for PR 1 (org-admission enforcement): submitting an offer
// previously required only network_visible + kyb_status!=='not_started'
// (Ghost Mode) — a submitted/under_review/rejected/suspended org could bid.
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
  return new Request('https://example.com/api/marketplace/offers', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
})

const validOfferBody = { listing_id: 'listing-1', offered_price: 100, offered_quantity: 1 }

describe('POST /api/marketplace/offers — admission enforcement (PR 1)', () => {
  const nonAdmittedCases: Array<{ label: string; status: string; kyb_status: string }> = [
    { label: 'submitted', status: 'kyb_submitted', kyb_status: 'submitted' },
    { label: 'under_review', status: 'kyb_submitted', kyb_status: 'under_review' },
    { label: 'more_info_requested', status: 'kyb_submitted', kyb_status: 'more_info_requested' },
    { label: 'rejected', status: 'rejected', kyb_status: 'rejected' },
    { label: 'suspended (was approved, later suspended)', status: 'suspended', kyb_status: 'approved' },
  ]

  for (const { label, status, kyb_status } of nonAdmittedCases) {
    it(`denies a ${label} organization`, async () => {
      const { POST } = await import('./route')

      state.currentUser = { id: 'user-1' }
      state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
      state.tables.organizations = { data: { id: 'org-1', status, kyb_status, network_visible: true, legal_name: 'Test Org', passport_score: 50 } }

      const res = await POST(postRequest(validOfferBody))
      expect(res.status).toBe(403)
    })
  }

  it('rejects unauthenticated requests', async () => {
    const { POST } = await import('./route')

    state.currentUser = null
    const res = await POST(postRequest(validOfferBody))
    expect(res.status).toBe(401)
  })

  it('does not deny an approved organization at the admission gate (fails later, for an unrelated reason — the listing does not exist in this mock)', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
    state.tables.organizations = { data: { id: 'org-1', status: 'active', kyb_status: 'approved', network_visible: true, legal_name: 'Test Org', passport_score: 50 } }
    state.tables.marketplace_listings = { data: null }

    const res = await POST(postRequest(validOfferBody))
    // Must not be the admission-gate 403 — confirms an approved org clears the gate.
    expect(res.status).not.toBe(403)
  })
})
