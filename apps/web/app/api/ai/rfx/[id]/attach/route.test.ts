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

const uploadMock = vi.fn(async () => ({ error: null }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => createChain(state.tables[table] ?? { data: null, error: null }),
    storage: { from: () => ({ upload: uploadMock }) },
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.currentUser } }) },
  }),
}))

function postRequest(body: unknown): Request {
  return new Request('https://example.com/api/ai/rfx/draft-1/attach', { method: 'POST', body: JSON.stringify(body) })
}

beforeEach(() => {
  state.currentUser = null
  state.tables = {}
  uploadMock.mockClear()
})

describe('POST /api/ai/rfx/[id]/attach', () => {
  it('rejects unauthenticated requests', async () => {
    const { POST } = await import('./route')
    const res = await POST(postRequest({}), { params: Promise.resolve({ id: 'draft-1' }) })
    expect(res.status).toBe(401)
  })

  it('404s when the draft does not exist', async () => {
    const { POST } = await import('./route')
    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
    state.tables.rfx_drafts = { data: null }
    const res = await POST(postRequest({ entity_id: 'listing-1' }), { params: Promise.resolve({ id: 'draft-1' }) })
    expect(res.status).toBe(404)
  })

  it('rejects attaching a draft owned by another org', async () => {
    const { POST } = await import('./route')
    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
    state.tables.rfx_drafts = { data: { id: 'draft-1', org_id: 'org-2', entity_type: 'listing', content: 'x' } }
    const res = await POST(postRequest({ entity_id: 'listing-1' }), { params: Promise.resolve({ id: 'draft-1' }) })
    expect(res.status).toBe(403)
  })

  it('requires entity_id when the draft has none yet', async () => {
    const { POST } = await import('./route')
    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
    state.tables.rfx_drafts = { data: { id: 'draft-1', org_id: 'org-1', entity_type: 'listing', entity_id: null, content: 'x' } }
    const res = await POST(postRequest({}), { params: Promise.resolve({ id: 'draft-1' }) })
    expect(res.status).toBe(400)
  })

  it('finalizes a listing draft into a documents row', async () => {
    const { POST } = await import('./route')
    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
    state.tables.rfx_drafts = { data: { id: 'draft-1', org_id: 'org-1', entity_type: 'listing', entity_id: null, content: 'RFx body', title: 'My RFx' } }
    state.tables.marketplace_listings = { data: { org_id: 'org-1' } }
    state.tables.documents = { data: { id: 'doc-1' } }
    const res = await POST(postRequest({ entity_id: 'listing-1' }), { params: Promise.resolve({ id: 'draft-1' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.document_id).toBe('doc-1')
    expect(json.content).toBe('RFx body')
    expect(uploadMock).toHaveBeenCalled()
  })

  it('rejects attaching a deal draft when the caller is not a deal party', async () => {
    const { POST } = await import('./route')
    state.currentUser = { id: 'user-1' }
    state.tables.users = { data: { id: 'user-1', role: 'org_admin', org_id: 'org-1' } }
    state.tables.rfx_drafts = { data: { id: 'draft-1', org_id: 'org-1', entity_type: 'deal', entity_id: null, content: 'x' } }
    state.tables.deals = { data: { buyer_org_id: 'org-2', supplier_org_id: 'org-3' } }
    const res = await POST(postRequest({ entity_id: 'deal-1' }), { params: Promise.resolve({ id: 'draft-1' }) })
    expect(res.status).toBe(403)
  })
})
