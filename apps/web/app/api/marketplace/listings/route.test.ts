// Regression tests for PR 1 (org-admission enforcement): publishing a
// listing previously required only network_visible + kyb_status!=='not_started'
// (Ghost Mode) — a submitted/under_review/rejected/suspended org could post.
import { describe, expect, it, beforeEach, vi } from 'vitest'

interface MockUser { id: string }
interface TableResponse { data: unknown; error?: unknown; count?: number }

const state: {
  currentUser: MockUser | null
  tables: Record<string, TableResponse>
} = { currentUser: null, tables: {} }

// 'organizations' is queried both as a single row (.single(), the requester's
// own org) and as a list (.in(), the batch poster-org lookup) within the same
// GET call — auto-detect which mode terminated the chain so one stub can
// serve both shapes.
function createChain(response: TableResponse) {
  let isSingle = false
  const chain: Record<string, unknown> = {}
  const chainMethods = ['select', 'eq', 'neq', 'or', 'order', 'range', 'limit', 'not', 'in', 'contains', 'update', 'insert', 'delete']
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
    auth: {
      getUser: async () => ({ data: { user: state.currentUser } }),
    },
  }),
}))

function postRequest(body: unknown): Request {
  return new Request('https://example.com/api/marketplace/listings', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
})

const validListingBody = {
  listing_type: 'po_request',
  title: 'Test listing',
  status: 'draft', // draft avoids the line-items/shipping-cost validation path
}

describe('POST /api/marketplace/listings — admission enforcement (PR 1)', () => {
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
      state.tables.organizations = { data: { status, kyb_status, network_visible: true } }

      const res = await POST(postRequest(validListingBody))
      expect(res.status).toBe(403)
    })
  }

  it('allows an approved, active organization', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
    state.tables.organizations = { data: { status: 'active', kyb_status: 'approved', network_visible: true } }
    state.tables.marketplace_listings = { data: { id: 'listing-1', title: 'Test listing', status: 'draft' } }

    const res = await POST(postRequest(validListingBody))
    expect(res.status).toBe(201)
  })

  it('rejects unauthenticated requests', async () => {
    const { POST } = await import('./route')

    state.currentUser = null
    const res = await POST(postRequest(validListingBody))
    expect(res.status).toBe(401)
  })
})

function getRequest(qs = ''): Request {
  return new Request(`https://example.com/api/marketplace/listings${qs}`)
}

describe('GET /api/marketplace/listings — browsing gate for a non-admitted requester (PR 1b)', () => {
  it('returns an empty marketplace browse for a submitted (not yet approved) org — direct API access cannot bypass the waiting-page restriction', async () => {
    const { GET } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1', bank_id: null } }
    state.tables.organizations = { data: { network_visible: true, status: 'kyb_submitted', kyb_status: 'submitted' } }

    const res = await GET(getRequest())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.listings).toEqual([])
    expect(json.total).toBe(0)
  })

  it('still returns a non-admitted org\'s OWN listings via ?mine=true (historical/own-record access is permitted)', async () => {
    const { GET } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1', bank_id: null } }
    state.tables.organizations = { data: { network_visible: true, status: 'kyb_submitted', kyb_status: 'submitted' } }
    state.tables.marketplace_listings = { data: [{ id: 'listing-1', org_id: 'org-1' }], count: 1 }
    state.tables.listing_line_items = { data: [] }

    const res = await GET(getRequest('?mine=true'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.listings.length).toBe(1)
  })

  it('allows browsing for an approved, active org', async () => {
    const { GET } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1', bank_id: null } }
    state.tables.organizations = { data: { network_visible: true, status: 'active', kyb_status: 'approved' } }
    state.tables.marketplace_listings = { data: [], count: 0 }

    const res = await GET(getRequest())
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.total).toBe(0)
    expect(json.listings).toEqual([])
  })
})
