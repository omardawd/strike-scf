// Regression tests for PR 3: offer document attachment is server-controlled
// end to end — a document is only ever created fresh, by the authorized
// offeror, for this exact offer; there is no client-supplied document_ids
// array anywhere in this path.
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
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
      }),
    },
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.currentUser } }) },
  }),
}))

function uploadRequest(file: File): Request {
  const fd = new FormData()
  fd.set('file', file)
  return new Request('https://example.com/api/marketplace/offers/offer-1/documents', { method: 'POST', body: fd })
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
})

describe('POST /api/marketplace/offers/[id]/documents (PR 3)', () => {
  it('denies attaching a document to an offer you do not own — "unauthorized document IDs cannot be attached"', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', org_id: 'some-other-org' } }
    state.tables.marketplace_offers = { data: { id: 'offer-1', from_org_id: 'offeror-org', document_ids: [] } }

    const res = await POST(uploadRequest(new File(['spec sheet'], 'spec.pdf', { type: 'application/pdf' })), { params: Promise.resolve({ id: 'offer-1' }) })
    expect(res.status).toBe(403)
  })

  it('the offeror can attach a document, which is server-created and server-appended', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', org_id: 'offeror-org' } }
    state.tables.marketplace_offers = { data: { id: 'offer-1', from_org_id: 'offeror-org', document_ids: [] } }
    state.tables.documents = { data: { id: 'doc-new', name: 'spec.pdf' } }

    const res = await POST(uploadRequest(new File(['spec sheet'], 'spec.pdf', { type: 'application/pdf' })), { params: Promise.resolve({ id: 'offer-1' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.document.id).toBe('doc-new')
  })

  it('rejects the request when no file is provided', async () => {
    const { POST } = await import('./route')

    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', org_id: 'offeror-org' } }
    state.tables.marketplace_offers = { data: { id: 'offer-1', from_org_id: 'offeror-org', document_ids: [] } }

    const res = await POST(new Request('https://example.com', { method: 'POST', body: new FormData() }), { params: Promise.resolve({ id: 'offer-1' }) })
    expect(res.status).toBe(400)
  })
})
