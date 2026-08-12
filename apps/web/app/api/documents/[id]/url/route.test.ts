// Regression test for PR 1b: public passport-document access (the "org
// opted into the network" branch of canAccessDocument) previously required
// only network_visible — a submitted/rejected/suspended org's KYB documents
// were readable by anyone once the org merely submitted KYB.
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
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: { signedUrl: 'https://example.com/signed' }, error: null }),
      }),
    },
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.currentUser } }) },
  }),
}))

vi.mock('@/lib/audit/log', () => ({ writeAuditEvent: async () => {} }))

function getRequest(): Request {
  return new Request('https://example.com/api/documents/doc-1/url')
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
})

describe('GET /api/documents/[id]/url — admission enforcement for public passport docs (PR 1b)', () => {
  it('denies access to a submitted (not yet approved) org\'s public passport document', async () => {
    const { GET } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { role: 'org_admin', org_id: 'viewer-org', bank_id: null } }
    state.tables.documents = {
      data: { id: 'doc-1', storage_path: 'x', entity_type: 'organization', entity_id: 'org-2', document_kind: 'passport_document' },
    }
    state.tables.organizations = { data: { status: 'kyb_submitted', kyb_status: 'submitted' } }

    const res = await GET(getRequest(), { params: Promise.resolve({ id: 'doc-1' }) })
    expect(res.status).toBe(403)
  })

  it('allows access to an approved org\'s public passport document', async () => {
    const { GET } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { role: 'org_admin', org_id: 'viewer-org', bank_id: null } }
    state.tables.documents = {
      data: { id: 'doc-1', storage_path: 'x', entity_type: 'organization', entity_id: 'org-2', document_kind: 'passport_document' },
    }
    state.tables.organizations = { data: { status: 'active', kyb_status: 'approved' } }

    const res = await GET(getRequest(), { params: Promise.resolve({ id: 'doc-1' }) })
    expect(res.status).toBe(200)
  })

  it('the owning org can still access its own document regardless of admission status', async () => {
    const { GET } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { role: 'org_admin', org_id: 'org-2', bank_id: null } }
    state.tables.documents = {
      data: { id: 'doc-1', storage_path: 'x', entity_type: 'organization', entity_id: 'org-2', document_kind: 'passport_document' },
    }
    // No 'organizations' stub consulted — the own-org branch short-circuits
    // before ever checking admission.

    const res = await GET(getRequest(), { params: Promise.resolve({ id: 'doc-1' }) })
    expect(res.status).toBe(200)
  })
})

describe('GET /api/documents/[id]/url — offer quote documents (PR 3)', () => {
  const offerDoc = { id: 'doc-1', storage_path: 'x', entity_type: 'offer', entity_id: 'offer-1', document_kind: 'quote_document' }

  it('denies a third party (not the offeror or listing owner)', async () => {
    const { GET } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { role: 'org_admin', org_id: 'third-party-org', bank_id: null } }
    state.tables.documents = { data: offerDoc }
    state.tables.marketplace_offers = { data: { from_org_id: 'offeror-org', listing_id: 'listing-1' } }
    state.tables.marketplace_listings = { data: { org_id: 'buyer-org' } }

    const res = await GET(getRequest(), { params: Promise.resolve({ id: 'doc-1' }) })
    expect(res.status).toBe(403)
  })

  it('allows the offeror (supplier who uploaded it)', async () => {
    const { GET } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { role: 'org_admin', org_id: 'offeror-org', bank_id: null } }
    state.tables.documents = { data: offerDoc }
    state.tables.marketplace_offers = { data: { from_org_id: 'offeror-org', listing_id: 'listing-1' } }

    const res = await GET(getRequest(), { params: Promise.resolve({ id: 'doc-1' }) })
    expect(res.status).toBe(200)
  })

  it('allows the listing owner (buyer evaluating the quote)', async () => {
    const { GET } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { role: 'org_admin', org_id: 'buyer-org', bank_id: null } }
    state.tables.documents = { data: offerDoc }
    state.tables.marketplace_offers = { data: { from_org_id: 'offeror-org', listing_id: 'listing-1' } }
    state.tables.marketplace_listings = { data: { org_id: 'buyer-org' } }

    const res = await GET(getRequest(), { params: Promise.resolve({ id: 'doc-1' }) })
    expect(res.status).toBe(200)
  })
})
